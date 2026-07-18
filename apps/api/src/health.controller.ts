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
  async health(): Promise<{ status: "ok"; db: boolean }> {
    let db = false;
    try {
      await this.db.query("SELECT 1");
      db = true;
    } catch {
      db = false;
    }
    return { status: "ok", db };
  }
}
