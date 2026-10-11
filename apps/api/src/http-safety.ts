import { randomUUID } from "node:crypto";
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { PasswordCapacityError } from "./security";

export function requestLog(request: Request, response: Response, next: NextFunction) {
  const started = Date.now();
  const id = randomUUID();
  response.setHeader("X-Request-Id", id);
  response.on("finish", () => {
    // Route templates, never URL paths/queries (which can contain invitation tokens).
    if (request.path === "/health" || request.path === "/ready") return;
    console.log(JSON.stringify({ event: "http_request", id, method: request.method, route: request.route?.path ?? "unmatched", status: response.statusCode, durationMs: Date.now() - started }));
  });
  next();
}

@Catch()
export class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const parserStatus = (error as { status?: number })?.status;
    const status = error instanceof HttpException ? error.getStatus() : error instanceof PasswordCapacityError ? 503 : parserStatus === 413 || parserStatus === 400 ? parserStatus : 500;
    if (status >= 500) console.error(JSON.stringify({ event: "request_failed", id: response.getHeader("X-Request-Id"), status }));
    const payload = error instanceof HttpException ? error.getResponse() : null;
    const message = error instanceof PasswordCapacityError ? error.message : status === 500 ? "The request could not be completed. Try again" : typeof payload === "string" ? payload : (payload as { message?: unknown })?.message;
    response.status(status).json({ statusCode: status, message: message ?? "Request failed" });
  }
}
