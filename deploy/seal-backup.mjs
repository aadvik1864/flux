import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const header = Buffer.from("FLUX-BACKUP-001\n");
const [operation, input, output] = process.argv.slice(2);
async function main() {
  const key = process.env.FLUX_BACKUP_KEY;
  if (!/^[a-f0-9]{64}$/i.test(key ?? "")) throw new Error("FLUX_BACKUP_KEY must be an independent 64-hex-character secret");
  if (operation === "encrypt") {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
    cipher.setAAD(header);
    const file = await open(output, "wx", 0o600);
    try {
      await file.write(Buffer.concat([header, iv]));
      await pipeline(createReadStream(input), cipher, createWriteStream(output, { fd: file.fd, start: header.length + iv.length, autoClose: false }));
      await file.write(cipher.getAuthTag(), 0, 16, (await file.stat()).size);
      await file.sync();
    } finally { await file.close(); }
  } else if (operation === "decrypt") {
    const source = await open(input, "r");
    const size = (await source.stat()).size;
    const prefix = Buffer.alloc(header.length + 12);
    const tag = Buffer.alloc(16);
    try {
      await source.read(prefix, 0, prefix.length, 0);
      await source.read(tag, 0, tag.length, size - 16);
      if (!prefix.subarray(0, header.length).equals(header)) throw new Error("Unsupported backup format");
      const cipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), prefix.subarray(header.length));
      cipher.setAAD(header); cipher.setAuthTag(tag);
      await pipeline(createReadStream(input, { start: prefix.length, end: size - 17 }), cipher, createWriteStream(output, { flags: "wx", mode: 0o600 }));
    } catch (error) { await unlink(output).catch(() => {}); throw error; }
    finally { await source.close(); }
  } else throw new Error("Expected encrypt or decrypt");
}
main().catch(() => { console.error("Backup encryption/authentication failed. No restore was performed."); process.exitCode = 1; });
