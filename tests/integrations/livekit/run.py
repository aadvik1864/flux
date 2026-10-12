#!/usr/bin/env python3
"""Optional isolated, unmodified LiveKit feasibility fixture; not a Flux call service."""
import os
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[3]
livekit = "livekit/livekit-server:v1.13.9@sha256:d0c04791bf63ca8dcea123571827d56ba9504bd57c8d5de60ee03b5408cc3154"
browser = "mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f"
if json.loads((root / "node_modules/@playwright/test/package.json").read_text())["version"] != "1.64.0":
    raise RuntimeError("Update the pinned browser image together with Playwright")
name = "flux-calls-" + secrets.token_hex(5)
server = name + "-server"
client = name + "-browser"
directory = Path(tempfile.mkdtemp(prefix="flux-livekit-", dir="/tmp/opencode"))
os.chmod(directory, 0o700)
shutil.copytree(root / "tests/integrations/livekit", directory / "prototype")
(directory / "prototype/node_modules").mkdir()
key, secret = "fixture-" + secrets.token_hex(8), secrets.token_hex(32)
(directory / "keys.json").write_text(json.dumps({"key": key, "secret": secret}))
os.chmod(directory / "keys.json", 0o600)
(directory / "livekit.yaml").write_text(f"""port: 7880
bind_addresses: ["0.0.0.0"]
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  stun_servers: []
keys:
  {key}: {secret}
room:
  auto_create: false
  max_participants: 4
  empty_timeout: 300
  departure_timeout: 20
logging:
  level: warn
""")
os.chmod(directory / "livekit.yaml", 0o600)

def run(arguments, **kwargs):
    return subprocess.run(arguments, cwd=root, check=True, **kwargs)

try:
    run(["docker", "network", "create", name])
    run(["docker", "run", "-d", "--name", server, "--network", name, "--network-alias", "livekit", "--user", f"{os.getuid()}:{os.getgid()}",
         "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--memory", "512m", "--tmpfs", "/tmp",
         "-v", f"{directory}/livekit.yaml:/fixture.yaml:ro", livekit, "--config", "/fixture.yaml"])
    # No ports are published; media, signaling, keys, and fixture UI stay on this
    # disposable Docker network. The browser has no host Docker socket or devices.
    run(["docker", "run", "--name", client, "--network", name, "--init", "--user", f"{os.getuid()}:{os.getgid()}", "--read-only",
         "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--memory", "2g", "--shm-size", "1g", "--tmpfs", "/tmp",
         "-e", "HOME=/tmp", "-v", f"{directory}/prototype:/prototype:ro", "-v", f"{root}/node_modules:/prototype/node_modules:ro",
         "-v", f"{directory}:/artifacts", browser, "node", "/prototype/browser.mjs"], timeout=180)
except Exception:
    with (directory / "server.log").open("w") as output:
        subprocess.run(["docker", "logs", server], stdout=output, stderr=subprocess.STDOUT, check=False)
    raise
finally:
    subprocess.run(["docker", "rm", "--force", client, server], check=False, capture_output=True)
    subprocess.run(["docker", "network", "rm", name], check=False, capture_output=True)
    print(f"Private local LiveKit prototype evidence: {directory}")
