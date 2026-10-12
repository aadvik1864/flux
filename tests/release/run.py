#!/usr/bin/env python3
"""Isolated local production-mode test. Never uses the development database."""
import os
import json
from pathlib import Path
import secrets
import subprocess
import shutil
import tempfile

root = Path(__file__).resolve().parents[2]
browser_version = "1.64.0"
browser_image = "mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f"
if json.loads((root / "node_modules/@playwright/test/package.json").read_text())["version"] != browser_version:
    raise RuntimeError("Update the pinned release browser image together with @playwright/test")
project = "flux-release-" + secrets.token_hex(4)
restore_project = project + "-restore"
directory = Path(tempfile.mkdtemp(prefix="flux-release-", dir="/tmp/opencode"))
os.chmod(directory, 0o700)
source = directory / "source"
# All images and test scripts use the same frozen source, even if a dev watcher
# rewrites generated files or a user edits the checkout while the run is active.
shutil.copytree(root, source, ignore=shutil.ignore_patterns("node_modules", ".git", ".next", "dist", ".env", ".env.*", "production.env", "backups", "test-results", "playwright-report", "coverage", "__pycache__", "*.log", "*.tsbuildinfo"))
envfile = directory / "production.env"
config = {
    "FLUX_DOMAIN": "flux.example.com", "APP_ORIGIN": "https://flux.example.com:9443", "ACME_EMAIL": "operator@example.com",
    "COMPOSE_PROJECT_NAME": project, "FLUX_TAG": project, "S3_ACCESS_KEY": "flux-smoke",
    "MAIL_FROM": "flux@example.com", "SMTP_HOST": "inbox", "SMTP_PORT": "2525", "SMTP_SECURE": "true", "SMTP_USER": "smoke", "SMTP_PASSWORD": "smoke-password",
}
for key in ["POSTGRES_ADMIN_PASSWORD", "POSTGRES_APP_PASSWORD", "COLLABORATION_SECRET", "S3_SECRET_KEY", "MAIL_ENCRYPTION_KEY"]:
    config[key] = secrets.token_hex(32)
envfile.write_text("\n".join(f"{key}={value}" for key, value in config.items()))
os.chmod(envfile, 0o600)
subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(directory / "key.pem"), "-out", str(directory / "cert.pem"), "-days", "2", "-subj", "/CN=inbox", "-addext", "subjectAltName=DNS:inbox"], check=True, capture_output=True)
os.chmod(directory / "key.pem", 0o644)  # Disposable, generated test certificate, shared with non-root test container.
(directory / "Caddyfile").write_text((source / "deploy/Caddyfile").read_text().replace("{$FLUX_DOMAIN} {", "{$FLUX_DOMAIN}:9443 {\n  tls internal"))
override = directory / "smoke.yaml"
override.write_text(f"""services:
  gateway:
    ports: !override ["127.0.0.1:9443:9443"]
    volumes: ["{directory}/Caddyfile:/etc/caddy/Caddyfile:ro"]
    networks:
      default:
        aliases: [flux.example.com]
  api:
    environment: {{ NODE_EXTRA_CA_CERTS: /certs/cert.pem, MAIL_ALERT_WEBHOOK_URL: "https://inbox:8443/alerts" }}
    volumes: ["{directory}/cert.pem:/certs/cert.pem:ro"]
  tools:
    environment: {{ NODE_EXTRA_CA_CERTS: /certs/cert.pem }}
    volumes: ["{directory}/cert.pem:/certs/cert.pem:ro"]
  inbox:
    image: flux-tools:{project}
    command: [node, /app/tests/support/smtp-inbox.mjs]
    volumes: ["{directory}/key.pem:/certs/key.pem:ro", "{directory}/cert.pem:/certs/cert.pem:ro"]
    ports: ["127.0.0.1:8028:8080"]
  browser:
    image: {browser_image}
    profiles: [operations]
    init: true
    user: "{os.getuid()}:{os.getgid()}"
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    tmpfs: [/tmp]
    shm_size: 1gb
    mem_limit: 2g
    environment:
      HOME: /tmp
      FLUX_SMOKE_DIRECTORY: /artifacts
      FLUX_SMOKE_INBOX_URL: http://inbox:8080/messages
    volumes:
      - "{source}/tests/release/browser.mjs:/release/browser.mjs:ro"
      - "{root}/node_modules:/release/node_modules:ro"
      - "{directory}:/artifacts"
    command: [node, /release/browser.mjs]
""")
base = ["docker", "compose", "--env-file", str(envfile), "--project-name", project, "-f", str(source / "deploy/compose.prod.yaml")]
compose = base + ["-f", str(override)]
restore = ["docker", "compose", "--env-file", str(envfile), "--project-name", restore_project, "-f", str(source / "deploy/compose.prod.yaml")]
environment = {**os.environ, **config, "FLUX_SMOKE_DIRECTORY": str(directory), "FLUX_BACKUP_KEY": secrets.token_hex(32)}

def run(command, **kwargs):
    return subprocess.run(command, cwd=root, check=True, env=environment, **kwargs)

try:
    for target in ["tools", "api", "collaboration", "web"]:
        run(["docker", "build", "-f", str(source / "deploy/Dockerfile"), "--target", target, "-t", f"flux-{target}:{project}", str(source)])
    run(compose + ["up", "-d", "--wait", "postgres", "object-storage", "inbox"])
    run(compose + ["run", "--rm", "migrate"])
    run(compose + ["up", "-d", "--wait", "collaboration", "api", "web", "gateway"])
    run(compose + ["run", "--rm", "--no-deps", "tools", "node", "dist/operations.js", "smtp-check"])
    run(compose + ["run", "--rm", "--no-deps", "tools", "node", "/app/tests/release/check-mail.mjs"])
    run(compose + ["run", "--rm", "--no-deps", "tools", "node", "dist/operations.js", "invite", "owner@example.com"])
    # Browser networking is namespaced: unrelated host Docker interfaces cannot
    # interrupt Chromium with ERR_NETWORK_CHANGED. Never retry mutations to hide it.
    run(compose + ["run", "--rm", "--no-deps", "browser"])
    # Singleton enforcement is a real database lease, not just documentation.
    second = subprocess.run(compose + ["run", "--rm", "--no-deps", "collaboration"], cwd=root, env=environment, capture_output=True, text=True, timeout=40)
    if second.returncode == 0 or "Only one production collaboration" not in second.stderr + second.stdout:
        raise RuntimeError("Second collaboration process was not fenced")
    print("Production singleton lease check passed.")
    run(["python3", str(source / "deploy/backup.py"), "backup", str(directory / "backup.flux"), "--env-file", str(envfile), "--project", project])
    run(restore + ["up", "-d", "--wait", "postgres", "object-storage"])
    run(["python3", str(source / "deploy/backup.py"), "restore", str(directory / "backup.flux"), "--env-file", str(envfile), "--project", restore_project, "--confirm-empty"])
    run(restore + ["run", "--rm", "--no-deps", "--user", f"{os.getuid()}:{os.getgid()}", "-v", f"{directory}/state.json:/release-state.json:ro", "tools", "node", "/app/tests/release/check-restored.mjs", "/release-state.json"])
    refusal = subprocess.run(["python3", str(source / "deploy/backup.py"), "restore", str(directory / "backup.flux"), "--env-file", str(envfile), "--project", restore_project, "--confirm-empty"], cwd=root, env=environment, capture_output=True, text=True)
    if refusal.returncode == 0 or "not empty" not in refusal.stderr:
        raise RuntimeError("Restore did not refuse a populated target")
    print("Encrypted cold backup/restore and non-empty-target refusal passed.")
except Exception:
    diagnostics = directory / "diagnostics"
    diagnostics.mkdir(mode=0o700, exist_ok=True)
    # Save evidence before removing this run's containers. These fixtures contain
    # disposable credentials only; never upload the env file or database archive.
    for name, arguments in [("services.log", ["logs", "--no-color", "--tail", "300"]), ("services.json", ["ps", "--all", "--format", "json"])]:
        with (diagnostics / name).open("w") as output:
            subprocess.run(compose + arguments, cwd=root, env=environment, stdout=output, stderr=subprocess.STDOUT, check=False)
    containers = subprocess.run(compose + ["ps", "--all", "--quiet"], cwd=root, env=environment, capture_output=True, text=True, check=False).stdout.splitlines()
    if containers:
        with (diagnostics / "container-state.jsonl").open("w") as output:
            subprocess.run(["docker", "inspect", "--format", '{"name": {{json .Name}}, "state": {{json .State}}}', *containers], stdout=output, stderr=subprocess.STDOUT, check=False)
    raise
finally:
    # These randomly named projects/volumes were created by this run only.
    subprocess.run(compose + ["down", "--volumes"], cwd=root, env=environment, check=False)
    subprocess.run(restore + ["down", "--volumes"], cwd=root, env=environment, check=False)
    print(f"Local release-test artifacts (not committed): {directory}")
