import { Controller, Get } from "@nestjs/common";
import { DbService } from "./db/db.service";

@Controller("health")
export class HealthController {
  constructor(private readonly db: DbService) {}

  /**
   * Liveness that never throws: always answers 200 so the platform routes
   * traffic and DB problems surface as data (`db: false`) rather than a
   * blank Bad Gateway.
   */
  @Get()
  async health(): Promise<{
    status: "ok";
    db: boolean;
    dbError?: string;
  }> {
    try {
      await this.db.query("SELECT 1");
      return { status: "ok", db: true };
    } catch (err) {
      // Surface the real reason so a failing managed-DB connection is
      // diagnosable from the browser (SSL, auth, missing role, unreachable)
      // instead of hiding behind an opaque 500 on the first query.
      const e = err as { code?: string; message?: string };
      const dbError = `${e.code ?? ""} ${e.message ?? String(err)}`
        .trim()
        .slice(0, 300);
      return { status: "ok", db: false, dbError };
    }
  }
}
