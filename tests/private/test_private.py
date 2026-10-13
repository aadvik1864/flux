import contextlib
from copy import deepcopy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("flux_private", ROOT / "deploy/private.py")
private = importlib.util.module_from_spec(spec)
spec.loader.exec_module(private)


def composition():
    environment = {"NODE_ENV": "production", "AUTH_MODE": "invite-only", "REQUIRE_EMAIL_VERIFICATION": "true", "TRUST_PROXY_HOPS": "1",
                   "APP_ORIGIN": "https://flux.internal:8443", "COLLABORATION_SECRET": "c" * 64, "S3_SECRET_KEY": "d" * 64,
                   "MAIL_ENCRYPTION_KEY": "e" * 64, "MAIL_MODE": "smtp", "MAIL_FROM": "flux@inbox.invalid", "SMTP_HOST": "inbox",
                   "SMTP_USER": "fixture", "SMTP_PASSWORD": "fixture-password", "SMTP_SECURE": "true", "SMTP_PORT": "2525"}
    return {"name": "flux-private", "services": {
        "api": {"environment": environment}, "web": {}, "collaboration": {}, "object-storage": {}, "tools": {},
        "postgres": {"environment": {"POSTGRES_PASSWORD": "a" * 64, "POSTGRES_APP_PASSWORD": "b" * 64}},
        "gateway": {"environment": {"FLUX_DOMAIN": "flux.internal", "FLUX_PRIVATE_PORT": "8443"},
                    "ports": [{"host_ip": "100.64.0.1", "target": 8443, "published": "8443", "protocol": "tcp"}],
                    "volumes": [{"source": str(ROOT / "deploy/Caddyfile.private"), "target": "/etc/caddy/Caddyfile", "read_only": True}]},
    }}


class BindingTests(unittest.TestCase):
    def test_private_addresses_only(self):
        for address in ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.2", "100.64.0.1", "100.127.255.254", "::1", "fd7a:115c:a1e0::1"]:
            with self.subTest(address=address):
                self.assertEqual(str(private.private_address(address)), address)
        for address in ["", "0.0.0.0", "::", "8.8.8.8", "100.63.255.255", "100.128.0.0", "169.254.1.1", "ff02::1", "example.org"]:
            with self.subTest(address=address), self.assertRaises(private.PrivateError):
                private.private_address(address)

    def test_hostname_validation(self):
        self.assertEqual(private.hostname("Machine.VPN.Internal."), "machine.vpn.internal")
        for value in ["localhost", "local.test", "single", "-bad.internal", "a..internal", "https://flux.internal", "a/evil.internal", "a\n.internal"]:
            with self.subTest(value=value), self.assertRaises(private.PrivateError):
                private.hostname(value)

    def test_valid_composition_and_no_secret_results(self):
        result = private.validate_composition(composition(), "flux-private", "f" * 64)
        self.assertEqual(result, {"domain": "flux.internal", "address": "100.64.0.1", "port": 8443, "origin": "https://flux.internal:8443"})

    def test_all_other_ports_and_host_networking_are_rejected(self):
        for name in ["api", "web", "collaboration", "postgres", "object-storage", "tools"]:
            for change in [{"ports": [{"target": 4000}]}, {"network_mode": "host"}, {"privileged": True}]:
                config = composition(); config["services"][name].update(change)
                with self.subTest(name=name, change=change), self.assertRaises(private.PrivateError):
                    private.validate_composition(config, "flux-private", "f" * 64)

    def test_wildcard_public_extra_and_mismatched_ports_are_rejected(self):
        for change in [{"host_ip": "0.0.0.0"}, {"host_ip": "::"}, {"host_ip": "1.1.1.1"}, {"target": 443}, {"protocol": "udp"}, {"published": "80"}]:
            config = composition(); config["services"]["gateway"]["ports"][0].update(change)
            with self.subTest(change=change), self.assertRaises(private.PrivateError):
                private.validate_composition(config, "flux-private", "f" * 64)
        config = composition(); config["services"]["gateway"]["ports"].append(deepcopy(config["services"]["gateway"]["ports"][0]))
        with self.assertRaises(private.PrivateError):
            private.validate_composition(config, "flux-private", "f" * 64)

    def test_origin_tls_authentication_and_mail_are_not_weakened(self):
        for key, value in [("APP_ORIGIN", "http://flux.internal:8443"), ("APP_ORIGIN", "https://flux.internal:8443/"),
                           ("APP_ORIGIN", "https://flux.internal:443"), ("NODE_ENV", "development"), ("AUTH_MODE", "open"),
                           ("REQUIRE_EMAIL_VERIFICATION", "false"), ("TRUST_PROXY_HOPS", "2"), ("MAIL_MODE", "disabled"),
                           ("SMTP_USER", ""), ("SMTP_PASSWORD", ""), ("MAIL_FROM", "not email"), ("SMTP_PORT", "0")]:
            config = composition(); config["services"]["api"]["environment"][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(private.PrivateError):
                private.validate_composition(config, "flux-private", "f" * 64)

    def test_public_caddy_and_reused_secrets_are_rejected(self):
        config = composition(); config["services"]["gateway"]["volumes"][0]["source"] = str(ROOT / "deploy/Caddyfile")
        with self.assertRaises(private.PrivateError):
            private.validate_composition(config, "flux-private", "f" * 64)
        config = composition(); config["services"]["api"]["environment"]["MAIL_ENCRYPTION_KEY"] = "c" * 64
        with self.assertRaises(private.PrivateError):
            private.validate_composition(config, "flux-private", "f" * 64)
        with self.assertRaises(private.PrivateError):
            private.validate_composition(composition(), "flux-private", "e" * 64)

    def test_proxy_rules_match_without_public_acme_or_redirect(self):
        public = (ROOT / "deploy/Caddyfile").read_text()
        vpn = (ROOT / "deploy/Caddyfile.private").read_text()
        self.assertEqual(public[public.index("  encode zstd gzip"):], vpn[vpn.index("  encode zstd gzip"):])
        self.assertIn("tls internal", vpn)
        self.assertIn("auto_https disable_redirects", vpn)
        self.assertNotIn("ACME_EMAIL", vpn)


class StateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir="/tmp/opencode")
        self.directory = Path(self.temporary.name) / ".flux-private"
        with contextlib.redirect_stdout(io.StringIO()):
            private.initialize(self.directory, "flux.internal", "127.0.0.1")
        self.config = private.Configuration(self.directory)

    def tearDown(self):
        self.temporary.cleanup()

    def test_initialization_is_private_independent_and_never_overwrites(self):
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o700)
        for name in ["runtime.env", "backup.key", "operations.json"]:
            self.assertEqual((self.directory / name).stat().st_mode & 0o777, 0o600)
        values = dict(line.split("=", 1) for line in (self.directory / "runtime.env").read_text().splitlines() if "=" in line and not line.startswith("#"))
        keys = [values[key] for key in ["POSTGRES_ADMIN_PASSWORD", "POSTGRES_APP_PASSWORD", "COLLABORATION_SECRET", "S3_SECRET_KEY", "MAIL_ENCRYPTION_KEY"]]
        keys.append(private.secure_file(self.directory / "backup.key").strip())
        self.assertEqual(len(set(keys)), 6)
        self.assertTrue(all(len(key) == 64 for key in keys))
        original = (self.directory / "runtime.env").read_bytes()
        with self.assertRaises(FileExistsError):
            private.initialize(self.directory, "flux.internal", "127.0.0.1")
        self.assertEqual((self.directory / "runtime.env").read_bytes(), original)
        self.assertFalse(self.config.metadata["allow_local_backups"])

    def test_state_inside_build_context_and_world_readable_keys_are_rejected(self):
        with self.assertRaises(private.PrivateError):
            private.state_directory(ROOT / "unsafe-private-secrets")
        (self.directory / "backup.key").chmod(0o644)
        with self.assertRaises(private.PrivateError):
            private.secure_file(self.directory / "backup.key")

    def test_mistyped_local_only_acknowledgement_and_replica_are_rejected(self):
        original = self.config.metadata
        for update in [{"allow_local_backups": "false"}, {"allow_local_backups": 1}, {"alert_webhook": []},
                       {"replica": {"root": "relative-mount", "id": "a" * 32}}, {"replica": {"root": "/mount", "id": "invalid"}}]:
            private.save_json(self.directory / "operations.json", {**original, **update})
            with self.subTest(update=update), self.assertRaises(private.PrivateError):
                private.Configuration(self.directory)

    def test_start_preflight_refuses_missing_release_images_without_building(self):
        self.config.composition = {"services": {"api": {"image": "flux-api:fixture", "build": {}}}}
        with patch.object(private.subprocess, "run", return_value=Mock(returncode=1)) as run, self.assertRaisesRegex(private.PrivateError, "no automatic build"):
            self.config.check_images()
        self.assertEqual(run.call_args.args[0], ["docker", "--context", "default", "image", "inspect", "flux-api:fixture"])

    def test_lock_serializes_private_writer_actions(self):
        with self.config.lock():
            with self.assertRaises(private.Busy):
                with private.Configuration(self.directory).lock():
                    self.fail("A competing writer obtained the lock")
        with self.config.lock():
            pass

    def test_unconfigured_or_unmounted_replica_refuses_before_export(self):
        self.config.run = Mock()
        with self.assertRaises(private.PrivateError):
            self.config.backup()
        self.config.run.assert_not_called()
        self.config.metadata["replica"] = {"root": str(Path(self.temporary.name) / "unmounted"), "id": "a" * 32}
        with self.assertRaises(private.PrivateError):
            self.config.backup()
        self.config.run.assert_not_called()

    def test_target_registration_requires_a_separate_mounted_filesystem(self):
        target = Path(self.temporary.name) / "backup-disk"; target.mkdir()
        with self.assertRaises(private.PrivateError):
            self.config.set_target(target)
        self.assertFalse((target / ".flux-backup-target").exists())
        # A bind mount of the same filesystem is not a second-storage copy.
        with patch.object(private.Path, "is_mount", return_value=True), self.assertRaises(private.PrivateError):
            self.config.set_target(target)
        self.assertFalse((target / ".flux-backup-target").exists())

    def test_registered_mount_identity_is_checked_and_never_overwritten(self):
        target = Path(self.temporary.name) / "backup-disk"; target.mkdir()
        original_stat = private.Path.stat
        def filesystem_stat(path, *args, **kwargs):
            info = original_stat(path, *args, **kwargs)
            if path == target:
                fields = list(info); fields[2] = info.st_dev + 1
                return os.stat_result(fields)
            return info
        with patch.object(private.Path, "is_mount", return_value=True), patch.object(private.Path, "stat", filesystem_stat):
            self.config.set_target(target)
            marker = target / ".flux-backup-target"
            identity = marker.read_text()
            self.assertEqual(marker.stat().st_mode & 0o777, 0o600)
            self.assertEqual(self.config.target(), target)
            self.config.set_target(target)
            self.assertEqual(marker.read_text(), identity)
            marker.write_text("b" * 32 + "\n")
            with self.assertRaisesRegex(private.PrivateError, "identity changed"):
                self.config.target()
            marker.write_text("Existing user marker\n")
            with self.assertRaisesRegex(private.PrivateError, "not overwritten"):
                self.config.set_target(target)
            self.assertEqual(marker.read_text(), "Existing user marker\n")

    def test_missing_smtp_is_actionable_and_does_not_start_containers(self):
        self.config.run = Mock()
        with self.assertRaisesRegex(private.PrivateError, "MAIL_FROM, SMTP_HOST, SMTP_USER, SMTP_PASSWORD"):
            self.config.check()
        self.config.run.assert_not_called()

    def test_backup_key_is_passed_only_in_environment_and_overlay_is_retained(self):
        calls = []
        def export(command, **kwargs):
            calls.append((command, kwargs))
            Path(command[3]).write_bytes(b"fixture-encrypted-backup")
        self.config.run = export
        with contextlib.redirect_stdout(io.StringIO()):
            record = self.config.backup(local_only=True)
        command, kwargs = calls[0]
        self.assertNotIn((self.directory / "backup.key").read_text().strip(), " ".join(command))
        self.assertEqual(kwargs["environment"]["FLUX_BACKUP_KEY"], (self.directory / "backup.key").read_text().strip())
        self.assertIn("--compose-override", command)
        self.assertIn(str(ROOT / "deploy/compose.private.yaml"), command)
        self.assertFalse(record["replicated"])
        self.assertEqual(record["sha256"], private.checksum(self.directory / "backups" / record["archive"]))

    def test_replica_is_verified_and_never_overwrites_an_existing_archive(self):
        replica = Path(self.temporary.name) / "replica"; replica.mkdir()
        self.config.target = Mock(return_value=replica)
        self.config.run = lambda command, **_kwargs: Path(command[3]).write_bytes(b"encrypted-fixture")
        with contextlib.redirect_stdout(io.StringIO()):
            record = self.config.backup()
        self.assertTrue(record["replicated"])
        self.assertEqual(private.checksum(replica / record["archive"]), record["sha256"])
        previous = (self.directory / "last-backup.json").read_bytes()
        def colliding_export(command, **_kwargs):
            archive = Path(command[3]); archive.write_bytes(b"encrypted-fixture")
            (replica / archive.name).write_bytes(b"existing-user-archive")
        self.config.run = colliding_export
        with self.assertRaises(FileExistsError):
            self.config.backup()
        self.assertEqual((self.directory / "last-backup.json").read_bytes(), previous)
        self.assertEqual(len([path for path in replica.iterdir() if path.read_bytes() == b"existing-user-archive"]), 1)
        self.assertFalse(any("partial" in path.name for path in replica.iterdir()))

    def test_disconnected_target_keeps_local_archive_without_claiming_success(self):
        replica = Path(self.temporary.name) / "replica"; replica.mkdir()
        self.config.target = Mock(side_effect=[replica, private.PrivateError("Target disconnected")])
        self.config.run = lambda command, **_kwargs: Path(command[3]).write_bytes(b"encrypted-fixture")
        with self.assertRaises(private.PrivateError):
            self.config.backup()
        self.assertEqual(len(list((self.directory / "backups").iterdir())), 1)
        self.assertFalse((self.directory / "last-backup.json").exists())
        self.assertEqual(list(replica.iterdir()), [])

    def test_health_requires_recent_existing_archives_and_mounted_replica(self):
        self.config.ready = Mock()
        self.config.run = lambda command, **_kwargs: Path(command[3]).write_bytes(b"encrypted-fixture")
        self.config.metadata["allow_local_backups"] = True
        with contextlib.redirect_stdout(io.StringIO()), patch.object(private.shutil, "disk_usage", return_value=Mock(total=100, used=10)):
            record = self.config.backup(local_only=True)
            self.config.health()
            local = self.directory / "backups" / record["archive"]
            local.unlink()
            with self.assertRaisesRegex(private.PrivateError, "missing"):
                self.config.health()
            local.write_bytes(b"encrypted-fixture")
            self.config.metadata["allow_local_backups"] = False
            with self.assertRaisesRegex(private.PrivateError, "no verified"):
                self.config.health()
            record["replicated"] = True
            private.save_json(self.directory / "last-backup.json", record)
            self.config.target = Mock(side_effect=private.PrivateError("Target disconnected"))
            with self.assertRaisesRegex(private.PrivateError, "disconnected"):
                self.config.health()

    def test_health_rejects_stale_backups_and_disk_pressure(self):
        self.config.ready = Mock()
        record = {"completed_at": "2020-01-01T00:00:00+00:00", "replicated": False}
        private.save_json(self.directory / "last-backup.json", record)
        with patch.object(private.shutil, "disk_usage", return_value=Mock(total=100, used=10)), self.assertRaisesRegex(private.PrivateError, "30-hour"):
            self.config.health()
        with patch.object(private.shutil, "disk_usage", return_value=Mock(total=100, used=85)), self.assertRaisesRegex(private.PrivateError, "85%"):
            self.config.health()

    def test_certificate_export_refuses_private_key_output(self):
        self.config.run = Mock(return_value="-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n")
        with self.assertRaises(private.PrivateError):
            self.config.export_certificate()
        self.assertFalse((self.directory / "root-ca.crt").exists())

    def test_alerts_use_verified_https_redacted_payloads_and_no_redirects(self):
        for address in ["http://alert.invalid/", "https://user:password@alert.invalid/", "https://alert.invalid/#fragment"]:
            self.config.metadata["alert_webhook"] = address
            with self.subTest(address=address), self.assertRaises(private.PrivateError):
                self.config.notify("backup", "failed")
        self.config.metadata["alert_webhook"] = "https://alert.invalid/hook?token=fixture"
        connection = Mock(); connection.getresponse.return_value.status = 302
        with patch.object(private.http.client, "HTTPSConnection", return_value=connection) as https, self.assertRaises(private.PrivateError):
            self.config.notify("backup", "failed")
        https.assert_called_once_with("alert.invalid", None, timeout=5)
        self.assertEqual(connection.request.call_count, 1)
        self.assertEqual(json.loads(connection.request.call_args.args[2]), {"service": "flux-private", "job": "backup", "status": "failed"})
        connection.close.assert_called_once()

    def test_busy_health_defers_without_failure_or_alert(self):
        self.config.check = Mock(); self.config.notify = Mock()
        with self.config.lock(), contextlib.redirect_stdout(io.StringIO()):
            self.config.job("health")
        self.config.check.assert_not_called(); self.config.notify.assert_not_called()
        self.assertFalse((self.directory / "job-health.json").exists())

    def test_stalled_operation_is_reported_without_stopping_its_writer(self):
        self.config.check = Mock(); self.config.notify = Mock()
        with self.config.lock():
            old = private.time.time() - 31 * 60
            os.utime(self.directory / "operation.lock", (old, old))
            with self.assertRaisesRegex(private.PrivateError, "over 30 minutes"):
                self.config.job("health")
            with self.assertRaises(private.Busy):
                with private.Configuration(self.directory).lock():
                    self.fail("A stalled writer's lock was discarded")
        self.config.check.assert_not_called()
        self.config.notify.assert_called_once_with("health", "failed")
        self.assertEqual(json.loads((self.directory / "job-health.json").read_text())["status"], "failed")

    def test_failed_job_records_no_secret_output_and_alert_failure_is_bounded(self):
        secret = "fixture-password-that-must-not-be-logged"
        self.config.check = Mock(side_effect=RuntimeError(secret))
        self.config.notify = Mock(side_effect=RuntimeError(secret))
        output = io.StringIO()
        with contextlib.redirect_stderr(output), self.assertRaises(private.PrivateError) as error:
            self.config.job("health")
        self.assertNotIn(secret, str(error.exception) + output.getvalue() + (self.directory / "job-health.json").read_text())
        self.config.notify.assert_called_once_with("health", "failed")

    def test_successful_job_sends_one_recovery_after_failure(self):
        self.config.check = Mock(); self.config.health = Mock(); self.config.notify = Mock()
        private.save_json(self.directory / "job-health.json", {"status": "failed"})
        with contextlib.redirect_stdout(io.StringIO()):
            self.config.job("health"); self.config.job("health")
        self.config.notify.assert_called_once_with("health", "recovered")

    def test_recovery_alert_failure_does_not_invalidate_a_successful_job(self):
        self.config.check = Mock(); self.config.health = Mock(); self.config.notify = Mock(side_effect=RuntimeError("private-alert-token"))
        private.save_json(self.directory / "job-health.json", {"status": "failed"})
        output = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(output):
            self.config.job("health")
        self.assertEqual(json.loads((self.directory / "job-health.json").read_text())["status"], "ok")
        self.assertNotIn("private-alert-token", output.getvalue())

    def test_timer_generation_does_not_install_or_enable_anything(self):
        self.config.run = Mock(side_effect=AssertionError("No commands during template generation"))
        with contextlib.redirect_stdout(io.StringIO()):
            self.config.timer_files()
        self.assertEqual(len(list((self.directory / "systemd").iterdir())), 6)
        service = (self.directory / "systemd/flux-private-backup.service").read_text()
        self.assertIn("UMask=0077", service)
        self.assertIn(str(ROOT / "deploy/private.py"), service)
        self.assertIn('"job" "backup"', service)

    def test_unmanaged_user_units_are_not_overwritten(self):
        home = Path(self.temporary.name) / "home"
        destination = home / ".config/systemd/user"; destination.mkdir(parents=True)
        unit = destination / "flux-private-backup.service"; unit.write_text("Existing user work\n")
        self.config.check = Mock(); self.config.ready = Mock(); self.config.run = Mock()
        with patch.object(private.Path, "home", return_value=home), self.assertRaises(private.PrivateError):
            self.config.timer_files(allow_local=True, install=True)
        self.assertEqual(unit.read_text(), "Existing user work\n")
        self.config.run.assert_not_called()
        self.assertFalse(json.loads((self.directory / "operations.json").read_text())["allow_local_backups"])

    def test_other_private_instances_units_are_not_overwritten(self):
        home = Path(self.temporary.name) / "home"
        destination = home / ".config/systemd/user"; destination.mkdir(parents=True)
        unit = destination / "flux-private-backup.service"
        content = "# Managed by Flux private.py\n# State directory: /another/private-instance\n"
        unit.write_text(content)
        self.config.check = Mock(); self.config.ready = Mock(); self.config.run = Mock()
        with patch.object(private.Path, "home", return_value=home), self.assertRaises(private.PrivateError):
            self.config.timer_files(allow_local=True, install=True)
        self.assertEqual(unit.read_text(), content)
        self.config.run.assert_not_called()

    def test_dangling_user_unit_symlinks_are_not_replaced(self):
        home = Path(self.temporary.name) / "home"
        destination = home / ".config/systemd/user"; destination.mkdir(parents=True)
        unit = destination / "flux-private-backup.service"
        unit.symlink_to(destination / "missing.service")
        self.config.check = Mock(); self.config.ready = Mock(); self.config.run = Mock()
        with patch.object(private.Path, "home", return_value=home), self.assertRaises(private.PrivateError):
            self.config.timer_files(allow_local=True, install=True)
        self.assertTrue(unit.is_symlink())
        self.config.run.assert_not_called()

    def test_timer_installation_does_not_copy_unrelated_template_files(self):
        home = Path(self.temporary.name) / "home"
        templates = self.directory / "systemd"; templates.mkdir(mode=0o700)
        (templates / "user-notes.txt").write_text("Preserve user work\n")
        self.config.check = Mock(); self.config.ready = Mock(); self.config.run = Mock()
        with patch.object(private.Path, "home", return_value=home), contextlib.redirect_stdout(io.StringIO()):
            self.config.timer_files(allow_local=True, install=True)
        self.assertFalse((home / ".config/systemd/user/user-notes.txt").exists())
        self.assertEqual((templates / "user-notes.txt").read_text(), "Preserve user work\n")
        self.assertEqual(len(list((home / ".config/systemd/user").iterdir())), 6)

    @unittest.skipUnless(shutil.which("docker"), "Docker Compose is not installed")
    def test_actual_compose_ignores_shell_overrides_and_resolves_only_private_port(self):
        path = self.directory / "runtime.env"
        value = path.read_text().replace("MAIL_FROM=", "MAIL_FROM=flux@inbox.invalid").replace("SMTP_HOST=", "SMTP_HOST=inbox").replace("SMTP_USER=", "SMTP_USER=fixture").replace("SMTP_PASSWORD=", "SMTP_PASSWORD='literal$#p:ass'")
        private.save(path, value)
        with patch.dict(os.environ, {"FLUX_BIND_IP": "0.0.0.0", "FLUX_PRIVATE_PORT": "443", "APP_ORIGIN": "http://evil.invalid", "COMPOSE_FILE": "/unknown.yaml"}):
            config = private.Configuration(self.directory)
            result = config.check()
        self.assertEqual(result["address"], "127.0.0.1")
        self.assertEqual(result["port"], 8443)
        # Compose's round-trippable config escapes dollars; its interpolation
        # environment still holds the exact original quoted password.
        raw_environment = config.run(config.compose + ["config", "--environment"], capture=True)
        self.assertIn("SMTP_PASSWORD=literal$#p:ass\n", raw_environment)
        self.assertEqual(config.compose[:4], ["docker", "--context", "default", "compose"])
        self.assertNotIn("ports", config.composition["services"]["api"])


if __name__ == "__main__":
    unittest.main()
