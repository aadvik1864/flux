import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);

export function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt, 64) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const valid = /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored);
  const [salt, expected] = valid ? stored.split(":") : ["0".repeat(32), "0".repeat(128)];
  const key = await deriveKey(password, salt, 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(expected, "hex")) && valid;
}
