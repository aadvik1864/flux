import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { SnapshotStorage, digest, decodeSnapshot } from "@flux/storage";

const db = new PrismaClient();
const storage = new SnapshotStorage();
const [action, directory] = process.argv.slice(2);
async function main() {
  if (action === "check-empty") {
    await storage.ensureBucket();
    const objects = await storage.client.send(new ListObjectsV2Command({ Bucket: storage.bucket, MaxKeys: 1 }));
    if (objects.Contents?.length) throw new Error("Restore requires an empty dedicated snapshot bucket");
    return;
  }
  const checkpoints = await db.checkpoint.findMany({ orderBy: { id: "asc" }, select: { id: true, objectKey: true, checksum: true, byteLength: true } });
  if (action === "export") {
    await mkdir(join(directory, "snapshots"), { recursive: true });
    for (const checkpoint of checkpoints) {
      const object = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: checkpoint.objectKey }));
      if (!object.Body || object.ContentLength !== checkpoint.byteLength || checkpoint.byteLength > 8 * 1024 * 1024) throw new Error("A referenced checkpoint is missing or too large");
      const bytes = await object.Body.transformToByteArray();
      decodeSnapshot(bytes, checkpoint.checksum);
      await writeFile(join(directory, "snapshots", `${checkpoint.id}.json`), bytes, { mode: 0o600, flag: "wx" });
    }
    const migrations = await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
    await writeFile(join(directory, "manifest.json"), JSON.stringify({ format: "flux.backup", version: 1, createdAt: new Date().toISOString(), checkpoints, migrations }, null, 2), { mode: 0o600, flag: "wx" });
  } else if (action === "import") {
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    if (manifest.format !== "flux.backup" || manifest.version !== 1 || JSON.stringify(manifest.checkpoints) !== JSON.stringify(checkpoints)) throw new Error("Backup metadata doesn't match the restored database");
    const migrations = await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
    if (JSON.stringify(migrations) !== JSON.stringify(manifest.migrations)) throw new Error("Backup migration metadata doesn't match");
    // Verify everything before uploading any object or changing session generations.
    for (const checkpoint of checkpoints) {
      if (!/^[a-f0-9-]{36}$/.test(checkpoint.id)) throw new Error("Invalid checkpoint identifier");
      const bytes = await readFile(join(directory, "snapshots", `${checkpoint.id}.json`));
      if (bytes.byteLength !== checkpoint.byteLength) throw new Error("Checkpoint length mismatch");
      decodeSnapshot(bytes, checkpoint.checksum);
    }
    await storage.ensureBucket();
    for (const checkpoint of checkpoints) {
      const bytes = await readFile(join(directory, "snapshots", `${checkpoint.id}.json`));
      await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: checkpoint.objectKey, Body: bytes, IfNoneMatch: "*", ContentType: "application/json", Metadata: { sha256: digest(bytes) } }));
    }
    await db.$transaction(async tx => {
      // Old browser sessions, emailed credentials, and CRDT rooms must not survive a rollback.
      await tx.session.deleteMany();
      await tx.accountToken.deleteMany();
      await tx.signupInvitation.deleteMany();
      await tx.invitation.deleteMany();
      await tx.emailMessage.deleteMany();
      await tx.branch.updateMany({ data: { generation: { increment: 1 } } });
      await tx.documentState.updateMany({ data: { generation: { increment: 1 } } });
      await tx.securityEvent.create({ data: { type: "backup_restored_sessions_revoked" } });
    });
    console.log(JSON.stringify({ event: "backup_restored", checkpoints: checkpoints.length }));
  } else throw new Error("Unknown backup operation");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Backup data operation failed"); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); storage.client.destroy(); });
