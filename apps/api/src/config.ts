import { resolve } from "node:path";
import { config } from "dotenv";
import { z } from "zod";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

export const env = z.object({
  DATABASE_URL: z.url(),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  COLLABORATION_SECRET: z.string().min(32),
  COLLABORATION_INTERNAL_URL: z.url().default("http://localhost:1234"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
}).parse(process.env);

if (env.NODE_ENV === "production" && (
  !env.APP_ORIGIN.startsWith("https://") || env.COLLABORATION_SECRET.startsWith("replace-this")
)) {
  throw new Error("Production requires HTTPS and a non-example collaboration secret.");
}
