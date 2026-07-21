import { Injectable, Logger } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { FcmClient, type FcmNotification } from "./fcm.client";

/**
 * Push notifications to registered mobile devices. Device tokens are
 * identity-layer rows (push_tokens is global, no RLS — a device belongs to a
 * user, not a workspace), so everything here uses the raw DbService.query()
 * path, like refresh_tokens. Delivery is dormant until FCM_SERVICE_ACCOUNT
 * is configured; notifyUser is fire-and-forget and never throws, so a push
 * hiccup can never disturb the mutation that caused it.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly db: DbService,
    private readonly fcm: FcmClient,
  ) {}

  /** True when FCM is configured — lets callers skip work while dormant. */
  enabled(): boolean {
    return this.fcm.configured();
  }

  /** Register (or refresh) a device token. A token moves to its latest user. */
  async register(userId: string, token: string, platform: string): Promise<void> {
    await this.db.query(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             platform = EXCLUDED.platform,
             last_seen_at = now()`,
      [userId, token, platform],
    );
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.db.query(
      `DELETE FROM push_tokens WHERE token = $1 AND user_id = $2`,
      [token, userId],
    );
  }

  /** Best-effort push to every device of a user; dead tokens are pruned. */
  async notifyUser(userId: string, n: FcmNotification): Promise<void> {
    if (!this.fcm.configured()) return;
    try {
      const res = await this.db.query(
        `SELECT token FROM push_tokens WHERE user_id = $1`,
        [userId],
      );
      for (const row of res.rows) {
        const result = await this.fcm.send(row.token as string, n);
        if (result.unregistered) {
          await this.db.query(`DELETE FROM push_tokens WHERE token = $1`, [
            row.token as string,
          ]);
        }
      }
    } catch (err) {
      this.logger.warn(`push notify error: ${(err as Error).message}`);
    }
  }
}
