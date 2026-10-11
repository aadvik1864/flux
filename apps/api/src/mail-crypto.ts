import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function encryptMail(message: unknown, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(message), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map(part => part.toString("base64url")).join(".");
}

export function decryptMail(payload: string, key: string): { to: string; subject: string; text: string } {
  const [iv, tag, bytes] = payload.split(".").map(part => Buffer.from(part, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(bytes), cipher.final()]).toString("utf8"));
}
