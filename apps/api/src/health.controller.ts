import { Controller, Get, Logger } from "@nestjs/common";
import { DbService } from "./db/db.service";

@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  constructor(private readonly db: DbService) {}

  /**
   * Liveness that never throws: always answers 200 so the platform routes
   * traffic and DB problems surface as data (`db: false`) rather than a
   * blank Bad Gateway. The DB error detail (host/role/SSL posture, driver
   * internals) is logged server-side only — it is NOT returned, since this
   * endpoint is unauthenticated and public.
   */
  @Get()
  async health(): Promise<{ status: "ok"; db: boolean }> {
    try {
      await this.db.query("SELECT 1");
      return { status: "ok", db: true };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      this.logger.error(
        `health: DB check failed — ${e.code ?? ""} ${e.message ?? String(err)}`,
      );
      return { status: "ok", db: false };
    }
  }
}
