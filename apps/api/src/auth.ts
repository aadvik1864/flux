import {
  Body, Controller, Get, Global, Inject, Injectable, Module, Post, Req, Res,
  UnauthorizedException, ConflictException, UseGuards,
  type CanActivate, type ExecutionContext,
} from "@nestjs/common";
import { Prisma, type User } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { colorForUser, type PublicUser } from "@flux/shared";
import { Database } from "./database";
import { env } from "./config";
import { hashPassword, opaqueToken, tokenHash, verifyPassword } from "./security";
import { email, input, resourceName } from "./validation";

const COOKIE = "flux_session";
const sessionLength = 7 * 24 * 60 * 60 * 1000;
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production",
  path: "/",
};

export type AuthenticatedRequest = Request & {
  identity: { user: User; sessionId: string };
};

export function publicUser(user: User): PublicUser {
  return { id: user.id, name: user.name, email: user.email, color: colorForUser(user.id) };
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(Database) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[COOKIE];
    if (typeof token !== "string" || token.length > 100) throw new UnauthorizedException("Sign in to continue");
    const session = await this.db.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
    if (!session || session.expiresAt <= new Date()) throw new UnauthorizedException("Your session expired. Sign in again");
    request.identity = { user: session.user, sessionId: session.id };
    return true;
  }
}

@Controller("auth")
class AuthController {
  constructor(@Inject(Database) private readonly db: Database) {}

  private async startSession(user: User, response: Response) {
    const token = opaqueToken();
    await this.db.session.create({ data: {
      userId: user.id,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + sessionLength),
    } });
    response.cookie(COOKIE, token, { ...cookieOptions, maxAge: sessionLength });
    response.setHeader("Cache-Control", "no-store");
    return publicUser(user);
  }

  @Post("register")
  async register(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const data = input(z.object({
      name: resourceName,
      email,
      password: z.string().min(12, "Use a password with at least 12 characters").max(128),
    }), body);
    try {
      const user = await this.db.user.create({ data: {
        name: data.name,
        email: data.email,
        passwordHash: await hashPassword(data.password),
      } });
      return this.startSession(user, response);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("This email already has an account. Sign in instead");
      }
      throw error;
    }
  }

  @Post("login")
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const data = input(z.object({ email, password: z.string().min(1).max(128) }), body);
    const user = await this.db.user.findUnique({ where: { email: data.email } });
    const valid = await verifyPassword(data.password, user?.passwordHash ?? "");
    if (!user || !valid) throw new UnauthorizedException("Email or password is incorrect");
    return this.startSession(user, response);
  }

  @Get("me")
  @UseGuards(SessionGuard)
  me(@Req() request: AuthenticatedRequest) { return publicUser(request.identity.user); }

  @Post("logout")
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.[COOKIE];
    if (typeof token === "string") await this.db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
    response.clearCookie(COOKIE, cookieOptions);
    return { ok: true };
  }
}

@Global()
@Module({ controllers: [AuthController], providers: [SessionGuard], exports: [SessionGuard] })
export class AuthModule {}
