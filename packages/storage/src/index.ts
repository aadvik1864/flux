import { createHash } from "node:crypto";
import { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import type { DocumentContent } from "@flux/shared";

export const storageEnvSchema = z.object({
  S3_ENDPOINT: z.url().default("http://localhost:9010"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).default("flux-checkpoints"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(8),
});

export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export interface SnapshotPayload {
  format: "flux.document";
  schemaVersion: number;
  content: DocumentContent;
  yjsState: string;
}

export function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function encodeSnapshot(snapshot: SnapshotPayload): Buffer {
  const bytes = Buffer.from(JSON.stringify(snapshot));
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("Checkpoint exceeds the 8 MiB snapshot limit");
  return bytes;
}

export function decodeSnapshot(bytes: Uint8Array, expectedChecksum: string): SnapshotPayload {
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES || digest(bytes) !== expectedChecksum) throw new Error("Checkpoint integrity verification failed");
  const payload = z.object({
    format: z.literal("flux.document"), schemaVersion: z.number().int().positive(),
    content: z.object({ type: z.literal("doc") }).passthrough(),
    yjsState: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
  }).parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
  return payload as SnapshotPayload;
}

export class SnapshotStorage {
  readonly client: S3Client;
  readonly bucket: string;
  private initialization: Promise<void> | undefined;

  constructor(environment: Record<string, unknown> = process.env) {
    const config = storageEnvSchema.parse(environment);
    if (environment.NODE_ENV === "production" && (config.S3_SECRET_KEY.length < 32 || /local_only|replace|example/i.test(config.S3_SECRET_KEY))) throw new Error("Production requires non-example storage credentials of at least 32 characters");
    this.bucket = config.S3_BUCKET;
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT, region: config.S3_REGION, forcePathStyle: true,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      maxAttempts: 2, requestHandler: { connectionTimeout: 2000, requestTimeout: 10_000 },
    });
  }

  async ready() { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })); }

  async ensureBucket() {
    if (!this.initialization) {
      this.initialization = (async () => {
        try { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })); }
        catch (error) {
          if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
          try { await this.client.send(new CreateBucketCommand({ Bucket: this.bucket })); }
          catch (error) { if ((error as { name?: string }).name !== "BucketAlreadyOwnedByYou") throw error; }
        }
      })().catch(error => { this.initialization = undefined; throw error; });
    }
    return this.initialization;
  }

  async put(key: string, snapshot: SnapshotPayload): Promise<{ checksum: string; byteLength: number }> {
    await this.ensureBucket();
    const bytes = encodeSnapshot(snapshot);
    const checksum = digest(bytes);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: bytes, ContentType: "application/json",
      IfNoneMatch: "*", Metadata: { sha256: checksum },
    }));
    return { checksum, byteLength: bytes.byteLength };
  }

  async get(key: string, checksum: string): Promise<SnapshotPayload> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body || (result.ContentLength ?? 0) > MAX_SNAPSHOT_BYTES) throw new Error("Checkpoint snapshot is missing or too large");
    return decodeSnapshot(await result.Body.transformToByteArray(), checksum);
  }
}
