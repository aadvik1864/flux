import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
let activeChecks = 0;
const waitingChecks: Array<() => void> = [];

export class PasswordCapacityError extends Error {
  constructor() { super("Password checks are busy. Try again shortly"); }
}

async function passwordKey(password: string, salt: string, legacy = false): Promise<Buffer> {
  // OWASP's scrypt baseline uses 128 MiB. Bound native allocations as well as IP rates.
  if (activeChecks >= 2) {
    if (waitingChecks.length >= 16) throw new PasswordCapacityError();
    await new Promise<void>(resolve => waitingChecks.push(resolve));
  } else activeChecks += 1;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N: legacy ? 16384 : 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }, (error, key) => { if (error) reject(error); else resolve(key); });
    });
  } finally {
    const next = waitingChecks.shift();
    if (next) next(); else activeChecks -= 1;
  }
}

export function needsPasswordUpgrade(stored: string): boolean { return !stored.startsWith("scrypt-v1:"); }

export function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function credentialBucket(operation: string, address: string): string {
  return tokenHash(`${operation.toLowerCase().replace(/\/+$/, "")}:${address.toLowerCase().slice(0, 254)}`);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await passwordKey(password, salt);
  return `scrypt-v1:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const modern = /^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored);
  const legacy = /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored);
  const valid = modern || legacy;
  const [salt, expected] = modern ? stored.split(":").slice(1) : legacy ? stored.split(":") : ["0".repeat(32), "0".repeat(128)];
  const key = await passwordKey(password, salt, legacy);
  return timingSafeEqual(key, Buffer.from(expected, "hex")) && valid;
}
