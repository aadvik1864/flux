#!/usr/bin/env python3
"""Exercise the public demo in an isolated, frontend-only HTTPS stack."""
import http.client
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import ssl
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
BROWSER_VERSION = "1.64.0"
BROWSER_IMAGE = "mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f"
if json.loads((ROOT / "node_modules/@playwright/test/package.json").read_text())["version"] != BROWSER_VERSION:
    raise RuntimeError("Update the release browser image together with Playwright")

directory = Path(tempfile.mkdtemp(prefix="flux-showcase-", dir="/tmp/opencode"))
directory.chmod(0o700)
source = directory / "source"
shutil.copytree(ROOT, source, ignore=shutil.ignore_patterns(
    "node_modules", ".git", ".next", "dist", ".env", ".env.*", "production.env", "showcase.env",
    ".flux-private", "backups", "test-results", "playwright-report", "coverage", "__pycache__", "*.log", "*.tsbuildinfo",
))
# The frozen source is mounted read-only; create the nested bind-mount target now.
(source / "node_modules").mkdir()
project = "flux-showcase-" + secrets.token_hex(4)
environment = {**os.environ, "FLUX_DOMAIN": "flux.example.com", "ACME_EMAIL": "fixture@example.com", "FLUX_TAG": project, "COMPOSE_PROJECT_NAME": project}
envfile = directory / "showcase.env"
envfile.write_text("\n".join(f"{key}={environment[key]}" for key in ["FLUX_DOMAIN", "ACME_EMAIL", "FLUX_TAG", "COMPOSE_PROJECT_NAME"]))
envfile.chmod(0o600)
(directory / "Caddyfile").write_text((source / "deploy/Caddyfile.showcase").read_text().replace("{$FLUX_DOMAIN} {", "{$FLUX_DOMAIN}:9444 {\n  tls internal"))
override = directory / "fixture.yaml"
override.write_text(f"""services:
  gateway:
    ports: !override ["127.0.0.1:9444:9444"]
    volumes: !override
      - "{directory}/Caddyfile:/etc/caddy/Caddyfile:ro"
      - certificates:/data
      - caddy-config:/config
    networks:
      default:
        aliases: [flux.example.com]
  browser:
    image: {BROWSER_IMAGE}
    profiles: [tests]
    user: "{os.getuid()}:{os.getgid()}"
    init: true
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    tmpfs: [/tmp]
    shm_size: 1gb
    mem_limit: 2g
    working_dir: /release
    environment:
      HOME: /tmp
      FLUX_SHOWCASE_URL: https://flux.example.com:9444
      FLUX_SHOWCASE_FIXTURE_TLS: "true"
      FLUX_SHOWCASE_ARTIFACTS: /artifacts/test-results
    volumes:
      - "{source}:/release:ro"
      - "{ROOT}/node_modules:/release/node_modules:ro"
      - "{directory}:/artifacts"
    command: [node, node_modules/@playwright/test/cli.js, test, -c, playwright.showcase.config.ts]
""")
docker = ["docker", "--context", "default"]
base = docker + ["compose", "--env-file", str(envfile), "--project-name", project, "-f", str(source / "deploy/compose.showcase.yaml")]
compose = base + ["-f", str(override)]


def run(command, **kwargs):
    return subprocess.run(command, cwd=ROOT, env=environment, check=True, **kwargs)


def request(context, method, path):
    connection = http.client.HTTPSConnection("flux.example.com", 9444, context=context, timeout=10)
    connection._create_connection = lambda _address, timeout, *_args: socket.create_connection(("127.0.0.1", 9444), timeout)
    try:
        connection.request(method, path, headers={"Cookie": "flux_session=disposable-fixture"})
        response = connection.getresponse()
        response.read()
        return response.status, dict(response.getheaders())
    finally:
        connection.close()


try:
    config = json.loads(run(base + ["config", "--format", "json"], capture_output=True, text=True).stdout)
    if set(config["services"]) != {"web", "gateway"} or config["services"]["web"].get("ports"):
        raise RuntimeError("Showcase must contain only an unpublished web service and its HTTPS gateway")
    if set(config["services"]["web"]["environment"]) != {"APP_ORIGIN"}:
        raise RuntimeError("Showcase must not receive account, database, or SMTP configuration")
    run(docker + ["build", "-f", str(source / "deploy/Dockerfile"), "--target", "web", "-t", f"flux-web:{project}", str(source)])
    run(compose + ["up", "-d", "--wait", "--no-build"])
    deadline = time.monotonic() + 15
    while True:
        certificate = subprocess.run(compose + ["exec", "-T", "gateway", "cat", "/data/caddy/pki/authorities/local/root.crt"], env=environment, capture_output=True, text=True)
        if certificate.returncode == 0:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError("Showcase test CA was not ready")
        time.sleep(0.25)
    context = ssl.create_default_context(cadata=certificate.stdout)
    status, headers = request(context, "GET", "/demo")
    if status != 200 or "strict-dynamic" not in headers.get("Content-Security-Policy", "") or "Set-Cookie" in headers:
        raise RuntimeError("Demo must serve trusted HTTPS/CSP without setting a session cookie")
    if request(context, "GET", "/")[0] != 308:
        raise RuntimeError("Public root must redirect to the demo")
    for path in ["/login", "/files/example", "/api/auth/me", "/api/ready", "/sync", "/internal/rooms", "/demo-not-a-route"]:
        if request(context, "GET", path)[0] != 404:
            raise RuntimeError(f"Showcase exposed a non-demo route: {path}")
    for method in ["POST", "PUT", "PATCH", "DELETE"]:
        status, headers = request(context, method, "/demo")
        if status != 405 or headers.get("Allow") != "GET, HEAD":
            raise RuntimeError("Showcase must reject write methods before they reach Next.js")
    run(compose + ["run", "--rm", "--no-deps", "browser"])
    print("Public showcase passed: trusted HTTPS, read-only routing, no backend services, and Chromium/Firefox walkthroughs.")
except Exception:
    with (directory / "services.log").open("w") as output:
        subprocess.run(compose + ["logs", "--no-color", "--tail", "200"], env=environment, stdout=output, stderr=subprocess.STDOUT)
    raise
finally:
    subprocess.run(compose + ["down", "--volumes"], env=environment, check=False)
    print(f"Showcase artifacts: {directory}")
