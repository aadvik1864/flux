#!/usr/bin/env python3
"""Cold, authenticated backups. Restores refuse an existing database or bucket."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("action", choices=["backup", "restore"])
parser.add_argument("archive", type=Path)
parser.add_argument("--env-file", type=Path, default=root / "deploy/production.env")
parser.add_argument("--project", default="flux-production")
parser.add_argument("--confirm-empty", action="store_true")
args = parser.parse_args()
compose = ["docker", "compose", "--env-file", str(args.env_file.resolve()), "--project-name", args.project, "-f", str(root / "deploy/compose.prod.yaml")]
archive = args.archive.resolve()

def run(command, **kwargs):
    return subprocess.run(command, check=True, **kwargs)

def tool(directory, script, *arguments, key=False):
    command = compose + ["run", "--rm", "--no-deps", "--user", f"{os.getuid()}:{os.getgid()}", "-v", f"{directory}:/backup"]
    if key:
        command += ["-e", "FLUX_BACKUP_KEY"]
    run(command + ["tools", "node", f"/app/deploy/{script}", *arguments])

def checksum(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()

def main():
    if len(os.environ.get("FLUX_BACKUP_KEY", "")) != 64:
        raise ValueError("Set FLUX_BACKUP_KEY to an independent random 64-hex-character secret, stored off-server")
    if args.action == "backup" and archive.exists():
        raise ValueError("Backup output already exists; it will not be overwritten")
    if args.action == "restore" and not args.confirm_empty:
        raise ValueError("Restore requires --confirm-empty and a fresh, isolated Compose project")
    archive.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".flux-backup-", dir=archive.parent) as staging:
        directory = Path(staging)
        if args.action == "backup":
            running = run(compose + ["ps", "--status", "running", "--services"], capture_output=True, text=True).stdout.splitlines()
            if not {"postgres", "object-storage"}.issubset(running):
                raise ValueError("Database and object storage must be running")
            paused = [name for name in ["gateway", "api", "collaboration"] if name in running]
            try:
                if paused:
                    run(compose + ["stop", *paused])
                # All history/recovery writers are now stopped; dump and object export are coherent.
                with (directory / "database.dump").open("xb") as dump:
                    run(compose + ["exec", "-T", "postgres", "pg_dump", "-U", "flux_admin", "-d", "flux", "-Fc", "--no-owner", "--no-privileges"], stdout=dump)
                tool(directory, "backup-data.mjs", "export", "/backup")
                manifest_path = directory / "manifest.json"
                manifest = json.loads(manifest_path.read_text())
                manifest["databaseSha256"] = checksum(directory / "database.dump")
                manifest_path.write_text(json.dumps(manifest))
            finally:
                if paused:
                    run(compose + ["start", *reversed(paused)])
            with tarfile.open(directory / "raw.tar", "w:gz") as tar:
                for path in [directory / "database.dump", directory / "manifest.json", directory / "snapshots"]:
                    tar.add(path, arcname=path.name)
            tool(directory, "seal-backup.mjs", "encrypt", "/backup/raw.tar", "/backup/sealed.flux", key=True)
            # Atomic create, not replace: even a race cannot overwrite an existing backup.
            os.link(directory / "sealed.flux", archive)
            print(f"Encrypted backup created: {archive}")
        else:
            running = run(compose + ["ps", "--status", "running", "--services"], capture_output=True, text=True).stdout.splitlines()
            if any(name in running for name in ["api", "collaboration", "gateway"]):
                raise ValueError("Restore into a new project with only postgres and object-storage running")
            shutil.copyfile(archive, directory / "sealed.flux")
            tool(directory, "seal-backup.mjs", "decrypt", "/backup/sealed.flux", "/backup/raw.tar", key=True)
            with tarfile.open(directory / "raw.tar", "r:gz") as tar:
                total = 0
                available = int(shutil.disk_usage(directory).free * 0.8)
                for member in tar.getmembers():
                    total += member.size
                    path = Path(member.name)
                    valid = member.name in {"database.dump", "manifest.json", "snapshots"} or (path.parent == Path("snapshots") and path.suffix == ".json")
                    if not valid or path.is_absolute() or ".." in path.parts or not (member.isfile() or member.isdir()) or total > available:
                        raise ValueError("Unsafe or oversized backup archive")
                tar.extractall(directory, filter="data")
            manifest = json.loads((directory / "manifest.json").read_text())
            if checksum(directory / "database.dump") != manifest["databaseSha256"]:
                raise ValueError("Database checksum mismatch")
            tables = run(compose + ["exec", "-T", "postgres", "psql", "-U", "flux_admin", "-d", "flux", "-Atc", "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"], capture_output=True, text=True).stdout.strip()
            if tables != "0":
                raise ValueError("Target database is not empty; refusing to overwrite it")
            tool(directory, "backup-data.mjs", "check-empty", "/backup")
            with (directory / "database.dump").open("rb") as dump:
                run(compose + ["exec", "-T", "postgres", "pg_restore", "-U", "flux_admin", "-d", "flux", "--role=flux_app", "--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges"], stdin=dump)
            tool(directory, "backup-data.mjs", "import", "/backup")
            print("Restore verified. Sessions/links revoked and room generations advanced. Review before starting services.")

try:
    main()
except (ValueError, subprocess.CalledProcessError, OSError, KeyError) as error:
    parser.exit(1, f"Backup operation stopped: {error}\n")
