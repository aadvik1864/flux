import { z } from "zod";

export const runtimeSchema = z.object({
  DATABASE_URL: z.url(),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default("127.0.0.1"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  COLLABORATION_SECRET: z.string().min(32),
  COLLABORATION_INTERNAL_URL: z.url().default("http://localhost:1234"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTH_MODE: z.enum(["open", "invite-only"]).default("open"),
  REQUIRE_EMAIL_VERIFICATION: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  MAIL_MODE: z.enum(["disabled", "smtp"]).default("disabled"),
  MAIL_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  MAIL_FROM: z.email().optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_ALERT_WEBHOOK_URL: z.preprocess(value => value === "" ? undefined : value, z.url().optional()),
});

export function parseRuntimeConfig(environment: Record<string, unknown>) {
  const env = runtimeSchema.parse(environment);
  const origin = new URL(env.APP_ORIGIN);
  if (origin.origin !== env.APP_ORIGIN) throw new Error("APP_ORIGIN must be an origin without a path or trailing slash");
  if (env.MAIL_MODE === "smtp" && (!env.SMTP_HOST || !env.MAIL_FROM || !env.MAIL_ENCRYPTION_KEY)) {
    throw new Error("SMTP requires SMTP_HOST, MAIL_FROM, and a 64-hex-character MAIL_ENCRYPTION_KEY");
  }
  if (env.REQUIRE_EMAIL_VERIFICATION && env.MAIL_MODE !== "smtp") throw new Error("Email verification requires SMTP");
  if (env.MAIL_ALERT_WEBHOOK_URL) {
    const webhook = new URL(env.MAIL_ALERT_WEBHOOK_URL);
    if (webhook.protocol !== "https:" || webhook.username || webhook.password || webhook.hash) throw new Error("Mail alerts require HTTPS without URL userinfo or fragments");
  }
  if (env.NODE_ENV === "production") {
    const database = new URL(env.DATABASE_URL);
    if (!["postgresql:", "postgres:"].includes(database.protocol) || decodeURIComponent(database.password).length < (
      database.hostname.endsWith(".neon.tech") && database.searchParams.get("sslmode") === "require" ? 16 : 32
    ) || /local_only|replace|example/i.test(database.password)) throw new Error("Production requires non-example PostgreSQL credentials of at least 32 characters");
    if (origin.protocol !== "https:" || /localhost|\.test$/.test(origin.hostname)) throw new Error("Production requires a public HTTPS APP_ORIGIN");
    if (env.COLLABORATION_SECRET.length < 64 || /replace|example|local_only/i.test(env.COLLABORATION_SECRET)) throw new Error("Production requires a random collaboration secret of at least 64 characters");
    if (!env.REQUIRE_EMAIL_VERIFICATION) throw new Error("Production requires email verification");
    if (!env.SMTP_USER || !env.SMTP_PASSWORD) throw new Error("Production requires authenticated SMTP with TLS");
  }
  return env;
}
