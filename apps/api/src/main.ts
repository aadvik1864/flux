import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { json, type Request, type Response, type NextFunction } from "express";
import { env } from "./config";
import { DatabaseModule } from "./database";
import { AuthModule } from "./auth";
import { WorkspacesModule } from "./workspaces";
import { FilesModule } from "./files";
import { CheckpointsModule } from "./checkpoints";
import { BranchesModule } from "./branches";
import { DiscussionsModule } from "./discussions";
import { MailModule } from "./mail";
import { HealthController } from "./health";
import { requestLog, SafeErrors } from "./http-safety";

@Module({ imports: [DatabaseModule, MailModule, AuthModule, WorkspacesModule, FilesModule, CheckpointsModule, BranchesModule, DiscussionsModule], controllers: [HealthController] })
class AppModule {}

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.getHttpAdapter().getInstance().set("trust proxy", env.TRUST_PROXY_HOPS);
  app.use(requestLog);
  app.useGlobalFilters(new SafeErrors());
  const reviewParser = json({ limit: "256kb" });
  app.use((request: Request, response: Response, next: NextFunction) => {
    // A 1,000-block explicit review can exceed the normal small mutation limit.
    if (request.method === "POST" && /^\/files\/[^/]+\/branches\/[^/]+\/approvals\/?$/i.test(request.path)) reviewParser(request, response, next);
    else next();
  });
  app.useBodyParser("json", { limit: "64kb" });
  app.use(helmet());
  app.use(cookieParser());
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin !== env.APP_ORIGIN) {
      response.status(403).json({ message: "Request origin is not allowed" });
      return;
    }
    next();
  });
  app.use("/auth", rateLimit({
    windowMs: 15 * 60_000, limit: env.NODE_ENV === "production" ? 60 : 1000,
    standardHeaders: "draft-8", legacyHeaders: false,
    message: { message: "Too many attempts. Try again later" },
  }));
  app.use(rateLimit({ windowMs: 60_000, limit: env.NODE_ENV === "production" ? 300 : 3000, standardHeaders: "draft-8", legacyHeaders: false }));
  app.enableShutdownHooks();
  await app.listen(env.API_PORT, env.API_HOST);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
