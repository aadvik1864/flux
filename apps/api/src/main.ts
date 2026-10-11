import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { env } from "./config";
import { DatabaseModule } from "./database";
import { AuthModule } from "./auth";
import { WorkspacesModule } from "./workspaces";
import { FilesModule } from "./files";
import { CheckpointsModule } from "./checkpoints";

@Controller()
class HealthController {
  @Get("health") health() { return { service: "flux-api", status: "ok" }; }
}

@Module({ imports: [DatabaseModule, AuthModule, WorkspacesModule, FilesModule, CheckpointsModule], controllers: [HealthController] })
class AppModule {}

async function main() {
  const app = await NestFactory.create(AppModule);
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
  app.use(["/auth/login", "/auth/register"], rateLimit({
    windowMs: 60_000, limit: env.NODE_ENV === "production" ? 20 : 100,
    standardHeaders: "draft-8", legacyHeaders: false,
  }));
  app.enableShutdownHooks();
  await app.listen(env.API_PORT, "127.0.0.1");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
