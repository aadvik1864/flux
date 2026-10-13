#!/usr/bin/env python3
"""Private-network Flux deployment and small, locked host jobs (Python 3.12+)."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import ssl
import stat
import subprocess
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
PRIVATE_NETWORKS = tuple(ipaddress.ip_network(value) for value in (
    "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
    "100.64.0.0/10", "::1/128", "fc00::/7",
))


class PrivateError(Exception):
    """An operator-safe error that never includes command output or secrets."""


class Busy(PrivateError):
    pass


def private_address(value):
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        raise PrivateError("Use a literal VPN/private IP address, never a wildcard or public address") from None
    if not any(address.version == network.version and address in network for network in PRIVATE_NETWORKS):
        raise PrivateError("Only loopback, RFC1918, Tailscale CGNAT, or private IPv6 addresses are allowed")
    return address


def hostname(value):
    value = value.lower().rstrip(".")
    if len(value) > 253 or "." not in value or not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in value.split(".")):
        raise PrivateError("Use a private DNS hostname, such as the machine's VPN hostname")
    if "localhost" in value or value.endswith(".test"):
        raise PrivateError("Do not use the development localhost/.test origin for this production-mode kit")
    return value


def secure_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise PrivateError("Private configuration/key files must be owned by you, regular files, and chmod 600")
    return path.read_text()


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def save(path, content, replace=True):
    temporary = path.with_name("." + path.name + "." + secrets.token_hex(8))
    try:
        with open(temporary, "x", opener=lambda name, flags: os.open(name, flags, 0o600)) as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        if replace:
            os.replace(temporary, path)
        else:
            os.link(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def save_json(path, value):
    save(path, json.dumps(value, indent=2) + "\n")


def checksum(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def state_directory(directory):
    directory = directory.resolve()
    if any(character in str(directory) for character in ["\n", "\r", "\x00"]):
        raise PrivateError("Private state paths may not contain control characters")
    if directory.is_relative_to(ROOT) and directory.relative_to(ROOT).parts[0:1] != (".flux-private",):
        raise PrivateError("Keep secrets in .flux-private/ or outside the checkout, never inside a buildable source folder")
    return directory


def initialize(directory, domain=None, address=None, port=8443, project="flux-private"):
    if not domain and not address:
        try:
            result = subprocess.run(["tailscale", "status", "--json"], check=True, capture_output=True, text=True, timeout=10)
            network = json.loads(result.stdout)
            if network.get("BackendState") != "Running":
                raise ValueError()
            domain = network["Self"]["DNSName"]
            address = next(value for value in network["TailscaleIPs"] if ipaddress.ip_address(value).version == 4)
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, StopIteration):
            raise PrivateError("Connect your private VPN first, or supply both --hostname and --bind-ip") from None
    if not domain or not address:
        raise PrivateError("Supply both --hostname and --bind-ip")
    domain, address = hostname(domain), str(private_address(address))
    if not 1024 <= port <= 65535 or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", project):
        raise PrivateError("Use a port from 1024–65535 and a lowercase Compose project name")
    directory = state_directory(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    values = {
        "FLUX_DOMAIN": domain, "APP_ORIGIN": f"https://{domain}:{port}",
        "FLUX_BIND_IP": address, "FLUX_PRIVATE_PORT": str(port),
        "COMPOSE_PROJECT_NAME": project, "FLUX_TAG": "private-" + secrets.token_hex(8),
        # The base Compose requires this field; private Caddy does not use ACME.
        "ACME_EMAIL": "unused@flux.invalid", "S3_ACCESS_KEY": "flux-" + secrets.token_hex(8),
    }
    for key in ["POSTGRES_ADMIN_PASSWORD", "POSTGRES_APP_PASSWORD", "COLLABORATION_SECRET", "S3_SECRET_KEY", "MAIL_ENCRYPTION_KEY"]:
        values[key] = secrets.token_hex(32)
    values.update({"MAIL_FROM": "", "SMTP_HOST": "", "SMTP_PORT": "587", "SMTP_SECURE": "false", "SMTP_USER": "", "SMTP_PASSWORD": "", "MAIL_ALERT_WEBHOOK_URL": ""})
    save(directory / "runtime.env", "# Fill MAIL_FROM and SMTP fields. Quote passwords using Compose .env syntax.\n" + "\n".join(f"{key}={value}" for key, value in values.items()) + "\n", replace=False)
    save(directory / "backup.key", secrets.token_hex(32) + "\n", replace=False)
    save_json(directory / "operations.json", {"version": 1, "project": project, "replica": None, "allow_local_backups": False, "alert_webhook": None})
    print("Private configuration and independent secrets created. Fill runtime.env SMTP fields; no services or VPN settings were changed.")


def validate_composition(config, project, backup_key):
    services = config.get("services", {})
    if config.get("name") != project or not {"api", "web", "gateway", "collaboration", "postgres", "object-storage", "tools"}.issubset(services):
        raise PrivateError("Unexpected private Compose project/services")
    for name, service in services.items():
        if service.get("network_mode") == "host" or service.get("privileged"):
            raise PrivateError("Host networking and privileged services are not allowed")
        if name != "gateway" and service.get("ports"):
            raise PrivateError("Only the private HTTPS gateway may publish a port")
    ports = services["gateway"].get("ports", [])
    if len(ports) != 1:
        raise PrivateError("The private gateway must publish exactly one TCP port")
    port = ports[0]
    address = str(private_address(port.get("host_ip", "")))
    if port.get("protocol") != "tcp" or int(port["published"]) != int(port["target"]) or not 1024 <= int(port["published"]) <= 65535:
        raise PrivateError("Unexpected private HTTPS port mapping")
    environment = services["api"]["environment"]
    origin = urlsplit(environment.get("APP_ORIGIN", ""))
    domain = hostname(origin.hostname or "")
    if origin.scheme != "https" or origin.port != int(port["published"]) or origin.path or origin.query or origin.fragment or origin.username or origin.password:
        raise PrivateError("APP_ORIGIN must match the private HTTPS hostname and port exactly")
    gateway = services["gateway"]
    if gateway["environment"].get("FLUX_DOMAIN") != domain or str(gateway["environment"].get("FLUX_PRIVATE_PORT")) != str(port["published"]):
        raise PrivateError("Gateway hostname/port and APP_ORIGIN differ")
    mounts = [mount for mount in gateway.get("volumes", []) if mount.get("target") == "/etc/caddy/Caddyfile"]
    if len(mounts) != 1 or mounts[0].get("source") != str(ROOT / "deploy/Caddyfile.private") or not mounts[0].get("read_only"):
        raise PrivateError("The gateway must use the read-only private Caddy configuration")
    if environment.get("NODE_ENV") != "production" or environment.get("AUTH_MODE") != "invite-only" or environment.get("REQUIRE_EMAIL_VERIFICATION") != "true" or environment.get("TRUST_PROXY_HOPS") != "1":
        raise PrivateError("Production authentication and the single Caddy trust hop must remain enabled")
    if environment.get("MAIL_MODE") != "smtp" or any(not environment.get(key) for key in ["MAIL_FROM", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"]):
        raise PrivateError("Fill the authenticated SMTP/sender fields; account verification is not optional")
    if environment.get("SMTP_SECURE") not in ("true", "false"):
        raise PrivateError("SMTP_SECURE must be true (implicit TLS) or false (required STARTTLS)")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", environment["MAIL_FROM"]) or not 1 <= int(environment.get("SMTP_PORT", "0")) <= 65535:
        raise PrivateError("Use a valid sender email and SMTP port")
    keys = [services["postgres"]["environment"][key] for key in ["POSTGRES_PASSWORD", "POSTGRES_APP_PASSWORD"]]
    keys += [environment.get(key, "") for key in ["COLLABORATION_SECRET", "S3_SECRET_KEY", "MAIL_ENCRYPTION_KEY"]] + [backup_key]
    if any(not re.fullmatch(r"[a-f0-9]{64}", key) for key in keys) or len(set(keys)) != len(keys):
        raise PrivateError("Use independent 64-hex-character secrets, including the backup key")
    return {"domain": domain, "address": address, "port": int(port["published"]), "origin": environment["APP_ORIGIN"]}


class Configuration:
    def __init__(self, directory):
        self.directory = state_directory(directory)
        info = self.directory.stat()
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise PrivateError("The private state directory must be owned by you and chmod 700")
        self.metadata = json.loads(secure_file(self.directory / "operations.json"))
        self.project = self.metadata.get("project", "")
        if self.metadata.get("version") != 1 or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", self.project):
            raise PrivateError("Invalid private operations configuration")
        if not isinstance(self.metadata.get("allow_local_backups"), bool):
            raise PrivateError("allow_local_backups must be the JSON boolean true or false")
        if self.metadata.get("alert_webhook") is not None and not isinstance(self.metadata["alert_webhook"], str):
            raise PrivateError("alert_webhook must be an HTTPS URL string or null")
        replica = self.metadata.get("replica")
        if replica is not None and (not isinstance(replica, dict) or not isinstance(replica.get("root"), str)
                                    or not Path(replica["root"]).is_absolute() or not isinstance(replica.get("id"), str)
                                    or not re.fullmatch(r"[a-f0-9]{32}", replica["id"])):
            raise PrivateError("Backup replica must identify an absolute mount point and its Flux marker")
        text = secure_file(self.directory / "runtime.env")
        self.missing_mail = [key for key in ["MAIL_FROM", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"]
                             if re.search(r"^\s*" + key + r"\s*=\s*(?:''|\"\")?\s*(?:#.*)?$", text, re.M)]
        # Avoid silently inheriting unrelated app/Compose settings from the shell.
        names = set(re.findall(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=", text, re.M))
        for path in [ROOT / "deploy/compose.prod.yaml", ROOT / "deploy/compose.private.yaml"]:
            names.update(re.findall(r"\$\{([A-Za-z_][A-Za-z0-9_]*)", path.read_text()))
        names.update(["COMPOSE_FILE", "COMPOSE_PROFILES", "COMPOSE_PROJECT_NAME", "DOCKER_HOST", "DOCKER_CONTEXT"])
        self.environment = {key: value for key, value in os.environ.items() if key not in names}
        self.compose = ["docker", "--context", "default", "compose", "--env-file", str(self.directory / "runtime.env"), "--project-name", self.project,
                        "-f", str(ROOT / "deploy/compose.prod.yaml"), "-f", str(ROOT / "deploy/compose.private.yaml")]

    def run(self, command, capture=False, environment=None):
        result = subprocess.run(command, env=environment or self.environment, capture_output=True, text=True)
        if result.returncode:
            raise PrivateError("Operation failed; check configuration, service health, and permissions (command output withheld to protect secrets)")
        if not capture and result.stdout:
            print(result.stdout, end="")
        return result.stdout

    def check(self):
        if self.missing_mail:
            raise PrivateError("Fill these fields in runtime.env before starting: " + ", ".join(self.missing_mail))
        key = secure_file(self.directory / "backup.key").strip()
        raw = self.run(self.compose + ["--profile", "operations", "config", "--format", "json"], capture=True)
        self.composition = json.loads(raw)
        self.endpoint = validate_composition(self.composition, self.project, key)
        return self.endpoint

    def check_images(self):
        for image in {service["image"] for service in self.composition["services"].values() if "build" in service}:
            result = subprocess.run(["docker", "--context", "default", "image", "inspect", image], capture_output=True, env=self.environment)
            if result.returncode:
                raise PrivateError("Release images are missing. Build this unique FLUX_TAG explicitly before starting; no automatic build will be used")

    @contextmanager
    def lock(self):
        path = self.directory / "operation.lock"
        descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Busy("Another private Flux operation is running") from None
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise PrivateError("Operation lock must be your private regular file")
            os.ftruncate(descriptor, 0)
            os.write(descriptor, json.dumps({"pid": os.getpid(), "started_at": datetime.now(timezone.utc).isoformat()}).encode())
            yield
        finally:
            os.close(descriptor)

    def export_certificate(self):
        deadline = time.monotonic() + 15
        while True:
            try:
                certificate = self.run(self.compose + ["exec", "-T", "gateway", "cat", "/data/caddy/pki/authorities/local/root.crt"], capture=True)
                break
            except PrivateError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.25)  # Bounded read-only startup wait, never a mutation retry.
        if "PRIVATE KEY" in certificate or not certificate.startswith("-----BEGIN CERTIFICATE-----"):
            raise PrivateError("Expected only the public CA certificate")
        ssl.PEM_cert_to_DER_cert(certificate)
        save(self.directory / "root-ca.crt", certificate)

    def ready(self):
        endpoint = self.endpoint
        certificate = secure_file(self.directory / "root-ca.crt")
        context = ssl.create_default_context(cadata=certificate)
        connection = http.client.HTTPSConnection(endpoint["domain"], endpoint["port"], context=context, timeout=10)
        # Connect to the configured private address while still verifying the DNS
        # hostname/certificate. No public DNS/proxy or TLS-verification bypass.
        connection._create_connection = lambda _address, timeout, *_args: socket.create_connection((endpoint["address"], endpoint["port"]), timeout)
        try:
            connection.request("GET", "/api/ready")
            response = connection.getresponse()
            if response.status != 200 or json.loads(response.read(8192)).get("status") != "ready":
                raise PrivateError("Private HTTPS readiness failed")
        finally:
            connection.close()

    def target(self):
        replica = self.metadata.get("replica")
        if not replica:
            raise PrivateError("No backup replica configured; attach another mounted storage target or explicitly use --local-only")
        path = Path(replica["root"])
        if path.is_symlink() or not path.is_mount() or path.stat().st_dev == self.directory.stat().st_dev:
            raise PrivateError("Backup target is not mounted on a separate filesystem; refusing a local fallback")
        marker = path / ".flux-backup-target"
        if marker.is_symlink() or marker.read_text().strip() != replica["id"]:
            raise PrivateError("Backup target identity changed")
        return path

    def set_target(self, path):
        path = path.absolute()
        if path.is_symlink() or not path.is_mount() or path.stat().st_dev == self.directory.stat().st_dev:
            raise PrivateError("Choose an existing mounted separate filesystem; no directory will be created as a fallback")
        marker = path / ".flux-backup-target"
        if marker.exists():
            if marker.is_symlink():
                raise PrivateError("Backup target marker may not be a symlink")
            identity = marker.read_text().strip()
            if not re.fullmatch(r"[a-f0-9]{32}", identity):
                raise PrivateError("Existing backup target marker is not a Flux marker; it was not overwritten")
        else:
            identity = secrets.token_hex(16)
            save(marker, identity + "\n", replace=False)
        self.metadata["replica"] = {"root": str(path), "id": identity}
        self.metadata["allow_local_backups"] = False
        save_json(self.directory / "operations.json", self.metadata)

    def backup(self, local_only=False):
        target = None if local_only else self.target()  # Check before stopping writers.
        directory = self.directory / "backups"
        directory.mkdir(mode=0o700, exist_ok=True)
        if directory.is_symlink() or directory.stat().st_mode & 0o077:
            raise PrivateError("Managed backup directory must be private and may not be a symlink")
        name = "flux-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(4) + ".flux"
        archive = directory / name
        environment = {**self.environment, "FLUX_BACKUP_KEY": secure_file(self.directory / "backup.key").strip()}
        self.run([sys.executable, str(ROOT / "deploy/backup.py"), "backup", str(archive), "--env-file", str(self.directory / "runtime.env"),
                  "--project", self.project, "--docker-context", "default", "--compose-override", str(ROOT / "deploy/compose.private.yaml")], capture=True, environment=environment)
        digest = checksum(archive)
        if target:
            # Recheck the mount after export: an unplugged disk must not receive
            # a misleading "replica" on the original machine's filesystem.
            target = self.target()
            temporary = target / ("." + name + ".partial-" + secrets.token_hex(8))
            try:
                with archive.open("rb") as source, open(temporary, "xb", opener=lambda name, flags: os.open(name, flags, 0o600)) as output:
                    shutil.copyfileobj(source, output)
                    output.flush()
                    os.fsync(output.fileno())
                if checksum(temporary) != digest:
                    raise PrivateError("Backup replica checksum mismatch")
                self.target()
                os.link(temporary, target / name)  # Never overwrite another archive.
                sync_directory(target)
            finally:
                temporary.unlink(missing_ok=True)
        result = {"archive": name, "sha256": digest, "completed_at": datetime.now(timezone.utc).isoformat(), "replicated": bool(target)}
        save_json(self.directory / "last-backup.json", result)
        print("Encrypted backup completed; verified separate-storage copy." if target else "Encrypted LOCAL-ONLY backup completed. It does not protect against losing this machine/disk.")
        return result

    def health(self):
        self.ready()
        usage = shutil.disk_usage(self.directory)
        if usage.used / usage.total >= 0.85:
            raise PrivateError("Disk usage is at least 85%; review storage before it fills")
        record = json.loads(secure_file(self.directory / "last-backup.json"))
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(record["completed_at"])).total_seconds()
        if age < -300 or age > 30 * 3600:
            raise PrivateError("No recent successful backup (30-hour limit)")
        if not record["replicated"] and not self.metadata.get("allow_local_backups"):
            raise PrivateError("Latest backup has no verified separate-storage copy")
        name = record["archive"]
        if not re.fullmatch(r"flux-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}\.flux", name):
            raise PrivateError("Unexpected managed backup record")
        archives = [self.directory / "backups" / name]
        if record["replicated"]:
            archives.append(self.target() / name)
        if any(path.is_symlink() or not path.is_file() or path.stat().st_size == 0 for path in archives):
            raise PrivateError("A recorded backup archive is missing, empty, or not a regular file")

    def notify(self, job, status):
        address = self.metadata.get("alert_webhook")
        if not address:
            return  # The journal/job state remains the default, explicitly local signal.
        destination = urlsplit(address)
        if destination.scheme != "https" or not destination.hostname or destination.username or destination.password or destination.fragment:
            raise PrivateError("Alerts require HTTPS without userinfo or fragments")
        connection = http.client.HTTPSConnection(destination.hostname, destination.port, timeout=5)
        try:
            body = json.dumps({"service": "flux-private", "job": job, "status": status})
            connection.request("POST", (destination.path or "/") + ("?" + destination.query if destination.query else ""), body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            if not 200 <= response.status < 300:
                raise PrivateError("Alert delivery failed (redirects are not followed)")
        finally:
            connection.close()

    def job(self, job):
        path = self.directory / f"job-{job}.json"
        previous = json.loads(secure_file(path)) if path.exists() else {}
        try:
            with self.lock():
                self.check()
                if job == "backup":
                    self.backup(local_only=self.metadata.get("allow_local_backups", False))
                elif job == "maintenance":
                    self.run(self.compose + ["run", "--rm", "--no-deps", "tools", "node", "dist/operations.js", "maintenance"], capture=True)
                elif job == "health":
                    self.health()
                else:
                    raise PrivateError("Unknown job")
        except Busy:
            if job == "health" and time.time() - (self.directory / "operation.lock").stat().st_mtime > 30 * 60:
                save_json(path, {"status": "failed", "checked_at": datetime.now(timezone.utc).isoformat()})
                try:
                    self.notify(job, "failed")
                except Exception:
                    print("Independent alert delivery failed; check the local journal/job state.", file=sys.stderr)
                raise PrivateError("A private operation has blocked checks for over 30 minutes; inspect it without killing writers blindly") from None
            print("Job deferred during another private Flux operation.")
            return
        except Exception:
            save_json(path, {"status": "failed", "checked_at": datetime.now(timezone.utc).isoformat()})
            try:
                self.notify(job, "failed")
            except Exception:
                print("Independent alert delivery failed; check the local journal/job state.", file=sys.stderr)
            raise PrivateError(f"Private {job} job failed; inspect configuration, readiness, storage, and backup status") from None
        save_json(path, {"status": "ok", "checked_at": datetime.now(timezone.utc).isoformat()})
        if previous.get("status") == "failed":
            try:
                self.notify(job, "recovered")
            except Exception:
                print("Recovery alert delivery failed; the successful job result remains recorded locally.", file=sys.stderr)
        print(f"Private {job} job completed.")

    def timer_files(self, allow_local=False, install=False):
        def quote(value):
            return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%").replace("$", "$$") + '"'
        if install:
            self.check()
            self.ready()
            if not allow_local:
                self.target()
        directory = self.directory / "systemd"
        directory.mkdir(mode=0o700, exist_ok=True)
        if directory.is_symlink() or directory.stat().st_uid != os.getuid() or directory.stat().st_mode & 0o077:
            raise PrivateError("Managed timer directory must be your private directory, not a symlink")
        marker = "# Managed by Flux private.py\n# State directory: " + str(self.directory) + "\n"
        schedule = {"backup": "OnCalendar=*-*-* 03:00:00\nPersistent=true\n", "maintenance": "OnCalendar=*-*-* 03:30:00\nPersistent=true\n", "health": "OnBootSec=10m\nOnUnitActiveSec=5m\n"}
        units = []
        for job, timing in schedule.items():
            command = " ".join(quote(value) for value in [sys.executable, ROOT / "deploy/private.py", "--directory", self.directory, "job", job])
            save(directory / f"flux-private-{job}.service", marker + "[Unit]\nDescription=Flux private " + job + "\n[Service]\nType=oneshot\nUMask=0077\nExecStart=" + command + "\n")
            save(directory / f"flux-private-{job}.timer", marker + "[Unit]\nDescription=Flux private " + job + " timer\n[Timer]\n" + timing + "RandomizedDelaySec=2m\n[Install]\nWantedBy=timers.target\n")
            units += [directory / f"flux-private-{job}.service", directory / f"flux-private-{job}.timer"]
        if install:
            destination = Path.home() / ".config/systemd/user"
            destination.mkdir(parents=True, exist_ok=True)
            for unit in units:
                existing = destination / unit.name
                if existing.is_symlink() or (existing.exists() and not existing.read_text().startswith(marker)):
                    raise PrivateError("Existing unmanaged systemd units were not overwritten")
            self.metadata["allow_local_backups"] = allow_local
            save_json(self.directory / "operations.json", self.metadata)
            for unit in units:
                save(destination / unit.name, unit.read_text())
            self.run(["systemctl", "--user", "daemon-reload"], capture=True)
            self.run(["systemctl", "--user", "enable", "--now", *[f"flux-private-{job}.timer" for job in schedule]], capture=True)
            print("User timers enabled. They require a running machine/user manager; enable user lingering yourself if needed.")
        else:
            print("Timer templates generated only; nothing installed or enabled.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=ROOT / ".flux-private")
    commands = parser.add_subparsers(dest="operation", required=True)
    initial = commands.add_parser("init")
    initial.add_argument("--hostname")
    initial.add_argument("--bind-ip")
    initial.add_argument("--port", type=int, default=8443)
    initial.add_argument("--project", default="flux-private")
    for operation in ["check", "build", "start", "stop", "certificate", "ready", "health", "maintenance", "smtp-check", "mail-status"]:
        commands.add_parser(operation)
    commands.add_parser("invite").add_argument("email")
    commands.add_parser("backup-target").add_argument("path", type=Path)
    commands.add_parser("backup").add_argument("--local-only", action="store_true")
    timer = commands.add_parser("timers")
    timer.add_argument("--install", action="store_true")
    timer.add_argument("--allow-local-backups", action="store_true")
    commands.add_parser("job").add_argument("name", choices=["backup", "maintenance", "health"])
    args = parser.parse_args()
    if args.operation == "init":
        initialize(args.directory, args.hostname, args.bind_ip, args.port, args.project)
        return
    configuration = Configuration(args.directory)
    if args.operation == "job":
        configuration.job(args.name)
        return
    with configuration.lock():
        if args.operation == "timers":
            configuration.timer_files(args.allow_local_backups, args.install)
            return
        if args.operation == "backup-target":
            configuration.set_target(args.path)
            print("Backup target registered. A mounted disk/NAS is not automatically proof of off-host custody.")
            return
        endpoint = configuration.check()
        if args.operation == "check":
            print("Private preflight passed: single private TLS port, protected secrets, invite-only access, and authenticated SMTP configuration.")
        elif args.operation == "build":
            for image in {service["image"] for service in configuration.composition["services"].values() if "build" in service}:
                result = subprocess.run(["docker", "--context", "default", "image", "inspect", image], capture_output=True, env=configuration.environment)
                if result.returncode == 0:
                    raise PrivateError("This release image tag already exists. Reuse it without rebuilding or choose a new FLUX_TAG")
            configuration.run(configuration.compose + ["--profile", "operations", "build"])
        elif args.operation == "start":
            configuration.check_images()
            if not ipaddress.ip_address(endpoint["address"]).is_loopback:
                interfaces = json.loads(configuration.run(["ip", "-j", "address", "show"], capture=True))
                if endpoint["address"] not in [address["local"] for interface in interfaces for address in interface.get("addr_info", [])]:
                    raise PrivateError("The configured VPN address is not assigned locally; no public fallback will be used")
            configuration.run(configuration.compose + ["up", "-d", "--wait", "--no-build", "postgres", "object-storage"])
            configuration.run(configuration.compose + ["run", "--rm", "migrate"])
            configuration.run(configuration.compose + ["run", "--rm", "--no-deps", "tools", "node", "dist/operations.js", "smtp-check"])
            configuration.run(configuration.compose + ["up", "-d", "--wait", "--no-build"])
            configuration.export_certificate()
            configuration.ready()
            print("Private Flux started. Install the exported public root CA on your own clients before opening " + endpoint["origin"])
        elif args.operation == "stop":
            configuration.run(configuration.compose + ["stop"])
        elif args.operation == "certificate":
            configuration.export_certificate()
            print("Public CA certificate exported; no private key was exported.")
        elif args.operation == "backup":
            configuration.backup(args.local_only)
        elif args.operation in ["ready", "health"]:
            getattr(configuration, args.operation)()
            print("Private " + args.operation + " passed with trusted TLS.")
        else:
            arguments = [args.operation] + ([args.email] if args.operation == "invite" else [])
            configuration.run(configuration.compose + ["run", "--rm", "--no-deps", "tools", "node", "dist/operations.js", *arguments])


if __name__ == "__main__":
    try:
        main()
    except PrivateError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, KeyError, TypeError, ssl.SSLError, http.client.HTTPException):
        print("Private operation stopped. Check SMTP fields, chmod 600/700, private binding, service state, and mounted backup target. No secret output was printed.", file=sys.stderr)
        sys.exit(1)
