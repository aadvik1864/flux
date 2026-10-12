import {
  Body, Controller, Get, Global, Inject, Injectable, Module, Post, Req, Res,
  UnauthorizedException, ConflictException, UseGuards, ForbiddenException, BadRequestException, HttpException,
  type CanActivate, type ExecutionContext,
} from "@nestjs/common";
import { Prisma, type User, type AccountTokenPurpose } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { colorForUser, type PublicUser } from "@flux/shared";
import { Database } from "./database";
import { env } from "./config";
import { credentialBucket, hashPassword, needsPasswordUpgrade, opaqueToken, tokenHash, verifyPassword } from "./security";
import { email, input, resourceName } from "./validation";
import { queueMail } from "./mail";

const COOKIE = env.NODE_ENV === "production" ? "__Host-flux_session" : "flux_session";
const password = z.string().min(12, "Use a password with at least 12 characters").max(128);
const tokenInput = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const mailNotice = { verificationRequired: true, message: "If this address is eligible, a link will arrive by email. Check your inbox and spam folder." };
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
    if (env.REQUIRE_EMAIL_VERIFICATION && !session.user.emailVerifiedAt) throw new ForbiddenException("Verify your email address before opening Flux");
    request.identity = { user: session.user, sessionId: session.id };
    return true;
  }
}

@Injectable()
class CredentialThrottle implements CanActivate {
  constructor(@Inject(Database) private readonly db: Database) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (typeof request.body?.email !== "string") return true;
    const key = credentialBucket(String(request.route?.path ?? request.path), request.body.email);
    const now = new Date();
    const until = new Date(now.getTime() + 15 * 60_000);
    const [result] = await this.db.$queryRaw<{ hits: number }[]>(Prisma.sql`
      INSERT INTO "AuthThrottle" ("key", "hits", "expiresAt") VALUES (${key}, 1, ${until})
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE WHEN "AuthThrottle"."expiresAt" <= ${now} THEN 1 ELSE "AuthThrottle"."hits" + 1 END,
        "expiresAt" = CASE WHEN "AuthThrottle"."expiresAt" <= ${now} THEN ${until} ELSE "AuthThrottle"."expiresAt" END
      RETURNING "hits"
    `);
    if (result.hits > (env.NODE_ENV === "production" ? 10 : 100)) throw new HttpException("Too many attempts. Try again in 15 minutes", 429);
    return true;
  }
}

@Controller("auth")
@UseGuards(CredentialThrottle)
export class AuthController {
  constructor(@Inject(Database) private readonly db: Database) {}

  private async startSession(tx: Prisma.TransactionClient, user: User) {
    const token = opaqueToken();
    const old = await tx.session.findMany({ where: { userId: user.id }, orderBy: { expiresAt: "desc" }, skip: 19, select: { id: true } });
    if (old.length) await tx.session.deleteMany({ where: { id: { in: old.map(session => session.id) } } });
    await tx.session.create({ data: {
      userId: user.id,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + sessionLength),
    } });
    return { token, user: publicUser(user) };
  }

  private finishSession(session: { token: string; user: PublicUser }, response: Response) {
    response.cookie(COOKIE, session.token, { ...cookieOptions, maxAge: sessionLength });
    response.setHeader("Cache-Control", "no-store");
    return session.user;
  }

  private async issue(tx: Prisma.TransactionClient, user: User, purpose: AccountTokenPurpose) {
    const token = opaqueToken();
    const expiresAt = new Date(Date.now() + (purpose === "VERIFY_EMAIL" ? 24 * 3600_000 : 30 * 60_000));
    await tx.accountToken.deleteMany({ where: { userId: user.id, purpose } });
    await tx.accountToken.create({ data: { tokenHash: tokenHash(token), userId: user.id, purpose, expiresAt } });
    const action = purpose === "VERIFY_EMAIL" ? "verify-email" : "reset-password";
    // The fragment isn't sent to HTTP servers or referrer logs. Opening it does not consume it.
    await queueMail(tx, user.email, purpose === "VERIFY_EMAIL" ? "Verify your Flux email" : "Reset your Flux password", `${purpose === "VERIFY_EMAIL" ? "Verify your email and choose your password" : "Choose a new password"}:\n${env.APP_ORIGIN}/account/${action}#${token}\n\nIf you did not request this, ignore this message.`, expiresAt);
  }

  @Get("options")
  options() { return { inviteOnly: env.AUTH_MODE === "invite-only", emailVerification: env.REQUIRE_EMAIL_VERIFICATION }; }

  @Post("register")
  async register(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const data = input(z.object({
      name: resourceName,
      email,
      password: password.optional(), invitationToken: tokenInput.optional(),
    }), body);
    if (!env.REQUIRE_EMAIL_VERIFICATION && !data.password) throw new BadRequestException("A password is required");
    if (env.AUTH_MODE === "invite-only" && !data.invitationToken) throw new ForbiddenException("An invitation is required to create an account");
    try {
      // Reject random/expired links before allocating password-check memory. This
      // is only a preflight: consumption is still checked atomically below.
      if (env.AUTH_MODE === "invite-only") {
        const where = { tokenHash: tokenHash(data.invitationToken!), email: data.email, acceptedAt: null, expiresAt: { gt: new Date() } };
        const [signup, workspace] = await Promise.all([
          this.db.signupInvitation.findFirst({ where, select: { id: true } }),
          this.db.invitation.findFirst({ where, select: { id: true } }),
        ]);
        if (!signup && !workspace) throw new ForbiddenException("The invitation is expired, used, or belongs to another email address");
      }
      const passwordHash = await hashPassword(env.REQUIRE_EMAIL_VERIFICATION ? opaqueToken() : data.password!);
      const result = await this.db.$transaction(async tx => {
        if (env.AUTH_MODE === "invite-only") {
          if (!data.invitationToken) throw new ForbiddenException("An invitation is required to create an account");
          const hash = tokenHash(data.invitationToken);
          const signup = await tx.signupInvitation.updateMany({ where: { tokenHash: hash, email: data.email, acceptedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
          if (!signup.count && !await tx.invitation.findFirst({ where: { tokenHash: hash, email: data.email, acceptedAt: null, expiresAt: { gt: new Date() } } })) throw new ForbiddenException("The invitation is expired, used, or belongs to another email address");
        }
        const user = await tx.user.create({ data: { name: data.name, email: data.email, passwordHash } });
        await tx.securityEvent.create({ data: { type: "account_registered", userId: user.id } });
        if (env.REQUIRE_EMAIL_VERIFICATION) { await this.issue(tx, user, "VERIFY_EMAIL"); return null; }
        return this.startSession(tx, user);
      });
      return result ? this.finishSession(result, response) : mailNotice;
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
    if (env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) throw new ForbiddenException("Verify your email first. Request a new verification link below");
    const upgraded = needsPasswordUpgrade(user.passwordHash) ? await hashPassword(data.password) : null;
    const session = await this.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`);
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (current.passwordHash !== user.passwordHash) throw new UnauthorizedException("Password changed. Sign in again");
      if (upgraded) await tx.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
      await tx.securityEvent.create({ data: { type: "login_succeeded", userId: user.id } });
      return this.startSession(tx, current);
    });
    return this.finishSession(session, response);
  }

  @Post("request-verification")
  async requestVerification(@Body() body: unknown) { return this.requestLink(body, "VERIFY_EMAIL"); }

  @Post("forgot-password")
  async forgotPassword(@Body() body: unknown) { return this.requestLink(body, "RESET_PASSWORD"); }

  private async requestLink(body: unknown, purpose: AccountTokenPurpose) {
    const data = input(z.object({ email }), body);
    if (env.MAIL_MODE !== "smtp") return mailNotice;
    const user = await this.db.user.findUnique({ where: { email: data.email } });
    if (user && (purpose === "VERIFY_EMAIL" ? !user.emailVerifiedAt : !env.REQUIRE_EMAIL_VERIFICATION || user.emailVerifiedAt)) {
      await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`);
        const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        if (purpose === "VERIFY_EMAIL" && current.emailVerifiedAt) return;
        await this.issue(tx, current, purpose);
      });
    }
    return mailNotice;
  }

  @Post("verify-email")
  async verifyEmail(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const session = await this.consume(body, "VERIFY_EMAIL");
    return this.finishSession(session, response);
  }

  @Post("reset-password")
  async resetPassword(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const session = await this.consume(body, "RESET_PASSWORD");
    return this.finishSession(session, response);
  }

  private async consume(body: unknown, purpose: AccountTokenPurpose) {
    const data = input(z.object({ token: tokenInput, password }), body);
    const hash = tokenHash(data.token);
    const initial = await this.db.accountToken.findUnique({ where: { tokenHash: hash } });
    if (!initial || initial.purpose !== purpose || initial.expiresAt <= new Date()) throw new BadRequestException("This link is expired or has already been used. Request a new link");
    const passwordHash = await hashPassword(data.password);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${initial.userId} FOR UPDATE`);
      const token = await tx.accountToken.findUnique({ where: { tokenHash: hash } });
      if (!token || token.userId !== initial.userId || token.purpose !== purpose || token.expiresAt <= new Date()) throw new BadRequestException("This link is expired or has already been used. Request a new link");
      await tx.accountToken.deleteMany({ where: { userId: token.userId } });
      await tx.session.deleteMany({ where: { userId: token.userId } });
      const user = await tx.user.update({ where: { id: token.userId }, data: { passwordHash, ...(purpose === "VERIFY_EMAIL" ? { emailVerifiedAt: new Date() } : {}) } });
      await tx.securityEvent.create({ data: { type: purpose === "VERIFY_EMAIL" ? "email_verified" : "password_reset", userId: user.id } });
      return this.startSession(tx, user);
    });
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

  @Post("logout-all")
  @UseGuards(SessionGuard)
  async logoutAll(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    await this.db.session.deleteMany({ where: { userId: request.identity.user.id } });
    response.clearCookie(COOKIE, cookieOptions);
    return { ok: true };
  }
}

@Global()
@Module({ controllers: [AuthController], providers: [SessionGuard, CredentialThrottle], exports: [SessionGuard] })
export class AuthModule {}
