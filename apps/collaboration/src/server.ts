import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Server, type Document, type Connection } from "@hocuspocus/server";
import { Prisma, PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import * as Y from "yjs";
import { z } from "zod";
import { branchRoom, parseBranchRoom, can, colorForUser } from "@flux/shared";
import { SnapshotStorage } from "@flux/storage";
import { RoomGate } from "./room-gate.js";
import { HistoryCoordinator, HistoryError, historyCommandSchema, type RoomState } from "./history.js";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const env = z.object({
  DATABASE_URL: z.url(),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  COLLABORATION_SECRET: z.string().min(32),
  COLLABORATION_PORT: z.coerce.number().int().min(1).max(65535).default(1234),
}).parse(process.env);

if (process.env.NODE_ENV === "production" && (
  !env.APP_ORIGIN.startsWith("https://") || env.COLLABORATION_SECRET.startsWith("replace-this")
)) {
  throw new Error("Production requires HTTPS and a non-example collaboration secret.");
}

const claimsSchema = z.object({ sub: z.string(), sessionId: z.string(), room: z.string() });
type ConnectionContext = { userId: string; sessionId: string; workspaceId: string; branchId: string; generation: number; name: string; color: string };
const db = new PrismaClient();
const writes = new Map<string, Promise<void>>();
const rooms = new Map<string, RoomState>();
const gate = new RoomGate();
const messageLocks = new WeakMap<Connection, () => void>();
const storage = new SnapshotStorage();

async function authorize(context: ConnectionContext) {
  const [session, member, branch] = await Promise.all([
    db.session.findUnique({ where: { id: context.sessionId } }),
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: context.workspaceId, userId: context.userId } } }),
    db.branch.findUnique({ where: { id: context.branchId }, select: { generation: true } }),
  ]);
  if (!session || session.userId !== context.userId || session.expiresAt <= new Date() || !member) {
    throw { code: 4403, reason: "Workspace access was revoked or your session expired" };
  }
  if (!branch || branch.generation !== context.generation) {
    throw { code: 4409, reason: "Main was restored. Open the current revision" };
  }
  return member;
}

// All writes for a room are serialized. This first slice supports ONE sync server.
async function persist(documentName: string, document: Document): Promise<void> {
  const { branchId, generation } = parseBranchRoom(documentName);
  const state = new Uint8Array(Y.encodeStateAsUpdate(document));
  const version = { generation, revision: rooms.get(documentName)?.revision ?? 0 };
  const previous = writes.get(documentName) ?? Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    await db.$transaction(async tx => {
      const [branch] = await tx.$queryRaw<{ fileId: string; generation: number }[]>(Prisma.sql`
        SELECT "fileId", "generation" FROM "Branch" WHERE "id" = ${branchId} FOR UPDATE
      `);
      // Retired rooms and delayed debounced writes cannot overwrite a restored head.
      if (!branch || branch.generation !== generation) return;
      const previousState = await tx.documentState.findUnique({ where: { branchId } });
      if (previousState && previousState.generation === generation && (
        previousState.revision > version.revision || (
          previousState.revision === version.revision && Buffer.from(previousState.state).equals(Buffer.from(state))
        )
      )) return;
      await tx.documentState.upsert({ where: { branchId }, create: { branchId, state, ...version }, update: { state, ...version } });
      await tx.file.update({ where: { id: branch.fileId }, data: { updatedAt: new Date() } });
    });
  });
  writes.set(documentName, write);
  try { await write; }
  finally { if (writes.get(documentName) === write) writes.delete(documentName); }
}

const history = new HistoryCoordinator(db, storage, rooms, gate, persist);

const server = new Server<ConnectionContext>({
  name: "flux-collaboration",
  address: "127.0.0.1",
  port: env.COLLABORATION_PORT,
  stopOnSignals: false,
  debounce: 1000,
  maxDebounce: 5000,
  websocketOptions: { maxPayload: 2 * 1024 * 1024 },

  async onRequest({ request, response, instance }) {
    if (request.url?.split("?")[0] !== "/internal/history") return;
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    try {
      if (request.method !== "POST") throw new HistoryError(405, "Method not allowed");
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) throw new HistoryError(401, "A service credential is required");
      let verified: unknown;
      try {
        verified = jwt.verify(authorization.slice(7), env.COLLABORATION_SECRET, {
          algorithms: ["HS256"], issuer: "flux-api", audience: "flux-history",
        });
      } catch { throw new HistoryError(401, "Invalid service credential"); }
      const credential = z.object({ sub: z.string(), sessionId: z.string(), command: historyCommandSchema }).parse(verified);
      const result = await history.execute(instance, credential.command, credential.sub, credential.sessionId);
      response.writeHead(200); response.end(JSON.stringify(result));
    } catch (error) {
      const status = error instanceof HistoryError ? error.status : error instanceof z.ZodError ? 400 : 503;
      if (status === 503) console.error("History operation failed", error);
      response.writeHead(status);
      response.end(JSON.stringify({ message: error instanceof HistoryError ? error.message : "The history operation could not be confirmed. Refresh history or retry the same action" }));
    }
    // Hocuspocus treats a falsy rejection as a fully handled HTTP response.
    throw null;
  },

  async onAuthenticate({ token, documentName, connectionConfig, requestHeaders }) {
    const origin = requestHeaders.get("origin");
    // Non-browser clients have no Origin; they still need a scoped session token.
    if (origin && origin !== env.APP_ORIGIN) throw new Error("Origin is not allowed");
    const claims = claimsSchema.parse(jwt.verify(token, env.COLLABORATION_SECRET, {
      algorithms: ["HS256"], issuer: "flux-api", audience: "flux-collaboration",
    }));
    if (claims.room !== documentName || !documentName.startsWith("branch:")) throw new Error("Token is not valid for this room");
    const parsed = parseBranchRoom(documentName);
    const branch = await db.branch.findUnique({ where: { id: parsed.branchId }, include: { file: true } });
    if (!branch) throw new Error("Document not found");
    if (branchRoom(branch.id, branch.generation) !== claims.room) throw { code: 4409, reason: "Main was restored. Open the current revision" };
    const user = await db.user.findUniqueOrThrow({ where: { id: claims.sub } });
    const context: ConnectionContext = {
      userId: user.id, sessionId: claims.sessionId, workspaceId: branch.file.workspaceId,
      branchId: branch.id, generation: branch.generation,
      name: user.name, color: colorForUser(user.id),
    };
    const member = await authorize(context);
    connectionConfig.readOnly = !can(member.role, "edit");
    return context;
  },

  async beforeHandleMessage({ context, connection, documentName }) {
    const release = await gate.acquire(documentName);
    try {
      const member = await authorize(context);
      connection.readOnly = !can(member.role, "edit");
      messageLocks.set(connection, release);
    } catch (error) { release(); throw error; }
  },

  async afterHandleMessage({ connection }) {
    messageLocks.get(connection)?.();
    messageLocks.delete(connection);
  },

  async beforeHandleAwareness({ context, states }) {
    if (!context) return;
    // A client cannot impersonate another collaborator's displayed identity.
    for (const state of states.values()) state.user = { id: context.userId, name: context.name, color: context.color };
  },

  async onLoadDocument({ documentName, document }) {
    const { branchId, generation } = parseBranchRoom(documentName);
    const branch = await db.branch.findUnique({ where: { id: branchId } });
    if (!branch || branch.generation !== generation) throw new Error("This editing session is outdated");
    const state = await db.documentState.findUnique({ where: { branchId } });
    rooms.set(documentName, { generation, revision: state?.revision ?? 0 });
    if (state) {
      Y.applyUpdate(document, new Uint8Array(state.state));
    } else {
      // Seed on the server, once, rather than independently in every browser.
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.setAttribute("blockId", randomUUID());
      document.getXmlFragment("default").insert(0, [paragraph]);
      await persist(documentName, document);
    }
    return document;
  },

  async afterLoadDocument({ documentName, document }) {
    document.on("update", () => { const version = rooms.get(documentName); if (version) version.revision += 1; });
  },

  async afterUnloadDocument({ documentName }) { rooms.delete(documentName); },

  async onStoreDocument({ documentName, document }) {
    await persist(documentName, document);
  },

  async onStateless({ payload, documentName, document, connection }) {
    if (payload.length > 512) throw new Error("Invalid save request");
    const request = z.object({ type: z.literal("flush"), requestId: z.string().max(100) }).parse(JSON.parse(payload));
    // Hocuspocus processes each connection's messages in order. Earlier updates
    // are applied before this snapshot; acknowledge only after the DB commits.
    try {
      await persist(documentName, document);
      connection.sendStateless(JSON.stringify({ type: "saved", requestId: request.requestId }));
    } catch (error) {
      console.error("Document persistence failed", error);
      connection.sendStateless(JSON.stringify({ type: "save-failed", requestId: request.requestId }));
    }
  },
});

// Revoke idle read-only connections too, not just connections sending edits.
let checking = false;
const revocationTimer = setInterval(async () => {
  if (checking) return;
  checking = true;
  try {
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        try {
          const member = await authorize(connection.context);
          connection.readOnly = !can(member.role, "edit");
        } catch (error) {
          const close = error as { code?: number; reason?: string };
          connection.close({ code: close.code ?? 4403, reason: close.reason ?? "Workspace access was revoked or your session expired" });
        }
      }
    }
  } finally { checking = false; }
}, 5000);
revocationTimer.unref();

async function shutdown() {
  clearInterval(revocationTimer);
  await server.destroy();
  await Promise.allSettled([...writes.values()]);
  await db.$disconnect();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
await db.$connect();
await server.listen();
