import { Controller, Get, Inject, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common";
import { SnapshotStorage } from "@flux/storage";
import { Database } from "./database";
import { env } from "./config";

@Controller()
export class HealthController implements OnModuleDestroy {
  private readonly storage = new SnapshotStorage();
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get("health") health() { return { service: "flux-api", status: "ok" }; }
  @Get("ready") async ready() {
    try {
      await Promise.all([
        this.db.$queryRaw`SELECT 1`,
        this.storage.ready(),
        fetch(`${env.COLLABORATION_INTERNAL_URL}/ready`, { signal: AbortSignal.timeout(5000) }).then(response => { if (!response.ok) throw new Error("Sync unavailable"); }),
      ]);
      if (env.MAIL_MODE === "smtp" && await this.db.emailMessage.count({ where: { sentAt: null, createdAt: { lt: new Date(Date.now() - 15 * 60_000) } } })) throw new Error("Email backlog");
      return { service: "flux-api", status: "ready" };
    } catch { throw new ServiceUnavailableException("Dependencies are unavailable"); }
  }
  onModuleDestroy() { this.storage.client.destroy(); }
}
