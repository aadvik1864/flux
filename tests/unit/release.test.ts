import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "../../apps/api/src/runtime-config";
import { encryptMail, decryptMail } from "../../apps/api/src/mail-crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const production = {
  DATABASE_URL: `postgresql://flux:${"f".repeat(64)}@postgres:5432/flux`,
  APP_ORIGIN: "https://flux.example.com", NODE_ENV: "production",
  COLLABORATION_SECRET: "a".repeat(64), AUTH_MODE: "invite-only", REQUIRE_EMAIL_VERIFICATION: "true",
  MAIL_MODE: "smtp", MAIL_FROM: "flux@example.com", SMTP_HOST: "smtp.example.com", SMTP_USER: "test", SMTP_PASSWORD: "test",
  MAIL_ENCRYPTION_KEY: "b".repeat(64),
};

describe("production configuration", () => {
  it("preserves local demo defaults but fails closed in production", () => {
    expect(parseRuntimeConfig({ DATABASE_URL: production.DATABASE_URL, COLLABORATION_SECRET: "x".repeat(32) }).REQUIRE_EMAIL_VERIFICATION).toBe(false);
    expect(parseRuntimeConfig(production).AUTH_MODE).toBe("invite-only");
    expect(parseRuntimeConfig({ ...production, AUTH_MODE: "open" }).AUTH_MODE).toBe("open");
    expect(() => parseRuntimeConfig({ ...production, AUTH_MODE: "open", REQUIRE_EMAIL_VERIFICATION: "false" })).toThrow("email verification");
    for (const change of [ { DATABASE_URL: "postgresql://flux:password@postgres:5432/flux" }, { APP_ORIGIN: "http://flux.example.com" }, { APP_ORIGIN: "https://flux.example.com/" }, { COLLABORATION_SECRET: "replace-this".repeat(8) }, { REQUIRE_EMAIL_VERIFICATION: "false" }, { MAIL_MODE: "disabled" }, { SMTP_USER: "" }, { MAIL_ENCRYPTION_KEY: "short" } ]) expect(() => parseRuntimeConfig({ ...production, ...change })).toThrow();
  });
  it("encrypts the email outbox with authenticated encryption", () => {
    const message = { to: "person@example.com", subject: "Verify", text: "https://flux.example.com/account/verify-email#secret" };
    const encrypted = encryptMail(message, production.MAIL_ENCRYPTION_KEY);
    expect(encrypted).not.toContain("secret");
    expect(decryptMail(encrypted, production.MAIL_ENCRYPTION_KEY)).toEqual(message);
    expect(encryptMail(message, production.MAIL_ENCRYPTION_KEY)).not.toBe(encrypted);
    expect(() => decryptMail(encrypted, "c".repeat(64))).toThrow();
    const changed = encrypted.split(".");
    changed[2] = Buffer.from("altered message").toString("base64url");
    expect(() => decryptMail(changed.join("."), production.MAIL_ENCRYPTION_KEY)).toThrow();
  });
  it("allows an optional HTTPS mail alert endpoint but rejects insecure alerts", () => {
    expect(parseRuntimeConfig({ ...production, MAIL_ALERT_WEBHOOK_URL: "" }).MAIL_ALERT_WEBHOOK_URL).toBeUndefined();
    expect(parseRuntimeConfig({ ...production, MAIL_ALERT_WEBHOOK_URL: "https://alerts.example.com/flux" }).MAIL_ALERT_WEBHOOK_URL).toBe("https://alerts.example.com/flux");
    expect(() => parseRuntimeConfig({ ...production, MAIL_ALERT_WEBHOOK_URL: "http://alerts.example.com/flux" })).toThrow("HTTPS");
    for (const url of ["https://user:password@alerts.example.com/flux", "https://alerts.example.com/flux#secret"]) expect(() => parseRuntimeConfig({ ...production, MAIL_ALERT_WEBHOOK_URL: url })).toThrow("HTTPS");
  });
  it("seals backups, authenticates before restore, and rejects a wrong key", async () => {
    const directory = await mkdtemp("/tmp/opencode/flux-backup-unit-");
    const run = promisify(execFile);
    const script = resolve("deploy/seal-backup.mjs");
    const options = { env: { ...process.env, FLUX_BACKUP_KEY: "d".repeat(64) } };
    try {
      const source = join(directory, "source");
      const sealed = join(directory, "sealed");
      const restored = join(directory, "restored");
      await writeFile(source, "private document bytes");
      await run(process.execPath, [script, "encrypt", source, sealed], options);
      expect((await readFile(sealed)).includes(Buffer.from("private document"))).toBe(false);
      await run(process.execPath, [script, "decrypt", sealed, restored], options);
      expect(await readFile(restored, "utf8")).toBe("private document bytes");
      await expect(run(process.execPath, [script, "decrypt", sealed, join(directory, "wrong-key")], { env: { ...process.env, FLUX_BACKUP_KEY: "e".repeat(64) } })).rejects.toThrow();
      await expect(readFile(join(directory, "wrong-key"))).rejects.toThrow();
      const damaged = await readFile(sealed); damaged[damaged.length - 1] ^= 1;
      await writeFile(join(directory, "damaged"), damaged);
      await expect(run(process.execPath, [script, "decrypt", join(directory, "damaged"), join(directory, "corrupt")], options)).rejects.toThrow();
      await expect(readFile(join(directory, "corrupt"))).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
