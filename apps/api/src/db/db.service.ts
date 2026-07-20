import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient, QueryResult } from "pg";
import { loadConfig } from "../config";
import { makePool } from "./pool";

/**
 * Database access implementing the fail-closed RLS tenancy contract
 * (db/migrations/0001_core.sql):
 *
 * Every workspace-scoped read/write goes through withWorkspace(), which
 * opens a transaction and sets the transaction-local settings
 * `app.current_workspace` / `app.current_user` via set_config(..., true)
 * (SET LOCAL semantics). The RLS policies key off those settings; when
 * unset they read as NULL and every policy denies. Because the settings
 * are transaction-local they never leak across pooled connections, so this
 * is safe under transaction-mode connection pooling.
 *
 * withUser() sets only the user context — the pre-workspace flows (listing
 * one's own memberships, minting an access token) rely on the memberships
 * `membership_read` policy's user_id arm. query() is for the global,
 * non-RLS `users` and `refresh_tokens` tables only.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    this.pool = makePool(loadConfig().appDbUrl, 10);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /** Raw pool query — NO transaction, NO RLS context. Global tables only. */
  async query(text: string, params?: unknown[]): Promise<QueryResult> {
    return this.pool.query(text, params);
  }

  /** Run fn with only the user context bound (workspace picker / token mint). */
  async withUser<T>(
    userId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.inTransaction(async (client) => {
      await client.query("SELECT set_config('app.current_user', $1, true)", [
        userId,
      ]);
      return fn(client);
    });
  }

  /**
   * PUBLIC form path (M11): run fn with ONLY `app.form_token` bound — no
   * workspace, no user. The `forms_public_read` policy arm admits exactly the
   * one form row whose public_token matches; every other RLS policy in the
   * schema still reads its settings as NULL and denies, so this context can
   * never see any tenant data beyond that single form.
   */
  async withFormToken<T>(
    token: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.inTransaction(async (client) => {
      await client.query("SELECT set_config('app.form_token', $1, true)", [
        token,
      ]);
      return fn(client);
    });
  }

  /**
   * PUBLIC API path (M15): run fn with ONLY `app.pat_token` bound — no
   * workspace, no user. The `pat_tenant` policy's token arm admits exactly
   * the one personal-access-token row whose hash matches; every other RLS
   * policy still reads its settings as NULL and denies. Used solely to
   * resolve a presented token to its (workspace_id, user_id, scope) before
   * establishing the real tenant context.
   */
  async withPatToken<T>(
    tokenHash: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.inTransaction(async (client) => {
      await client.query("SELECT set_config('app.pat_token', $1, true)", [
        tokenHash,
      ]);
      return fn(client);
    });
  }

  /**
   * SYSTEM path (M15): run fn with ONLY `app.current_workspace` bound — no
   * user. For server-internal, non-user-driven work such as webhook dispatch
   * that must read a workspace's webhook rows off the event bus (where there
   * is no acting user). Tenant-scoped tables still enforce their workspace
   * arm, so this can only ever see the one workspace's rows.
   */
  async withWorkspaceSystem<T>(
    workspaceId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.inTransaction(async (client) => {
      await client.query(
        "SELECT set_config('app.current_workspace', $1, true)",
        [workspaceId],
      );
      return fn(client);
    });
  }

  /** Run fn with BOTH workspace and user context bound (all scoped work). */
  async withWorkspace<T>(
    workspaceId: string,
    userId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.inTransaction(async (client) => {
      await client.query(
        "SELECT set_config('app.current_workspace', $1, true), set_config('app.current_user', $2, true)",
        [workspaceId, userId],
      );
      return fn(client);
    });
  }

  private async inTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      // A dead connection makes ROLLBACK itself throw — always surface the
      // original error, not the rollback failure.
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
