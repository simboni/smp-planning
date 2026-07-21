import {
  ForbiddenException,
  Injectable,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  PLANS,
  planHasFeature,
  type PlanFeature,
  type PlanId,
} from "@stackup/shared";
import { DbService } from "../db/db.service";

/** Resolved caps for a workspace (plan defaults unless overridden in DB). */
export interface Limits {
  storageBytes: number;
  automationsPerMonth: number;
}

/** A single metered resource's current standing. */
export interface Meter {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
}

export interface UsageReport {
  storage: Meter & { usedBytes: number; limitBytes: number };
  automations: Meter & { periodStart: string };
}

function meter(used: number, limit: number): Meter {
  const remaining = Math.max(0, limit - used);
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return { used, limit, remaining, percent };
}

/**
 * Module 20 — limits & metering. Usage is computed live from the source rows
 * (attachment bytes; automation runs this calendar month), so it can never
 * drift from reality. Enforcement helpers run inside a caller's existing
 * withWorkspace transaction so the check and the write commit atomically.
 */
@Injectable()
export class LimitsService {
  constructor(private readonly db: DbService) {}

  /** The workspace's plan (M24). Falls back to free on anything unexpected. */
  async planId(client: PoolClient, workspaceId: string): Promise<PlanId> {
    const res = await client.query(`SELECT plan FROM workspaces WHERE id = $1`, [
      workspaceId,
    ]);
    const plan = res.rows[0]?.plan as PlanId | undefined;
    return plan && PLANS[plan] ? plan : "free";
  }

  /** Throw 403 with an upgrade hint unless the plan includes `feature`. */
  async requireFeature(
    client: PoolClient,
    workspaceId: string,
    feature: PlanFeature,
    label: string,
  ): Promise<void> {
    const plan = await this.planId(client, workspaceId);
    if (!planHasFeature(plan, feature)) {
      throw new ForbiddenException(
        `${label} is not included in the ${PLANS[plan].name} plan — upgrade in Settings → Plans`,
      );
    }
  }

  /**
   * Resolve caps: the plan's numbers, with a workspace_limits override row
   * (a billing/admin concern, set out-of-band) taking precedence per field.
   */
  private async limitsFor(client: PoolClient, workspaceId: string): Promise<Limits> {
    const plan = PLANS[await this.planId(client, workspaceId)];
    const res = await client.query(
      `SELECT storage_limit_bytes, automations_monthly_limit
         FROM workspace_limits WHERE workspace_id = $1`,
      [workspaceId],
    );
    const row = res.rows[0] as
      | { storage_limit_bytes: string | null; automations_monthly_limit: number | null }
      | undefined;
    return {
      storageBytes:
        row?.storage_limit_bytes != null
          ? Number(row.storage_limit_bytes)
          : plan.storageBytes,
      automationsPerMonth:
        row?.automations_monthly_limit != null
          ? row.automations_monthly_limit
          : plan.automationsPerMonth,
    };
  }

  /** Owner-gated plan switch (billing integration slots in front of this). */
  async selectPlan(
    workspaceId: string,
    userId: string,
    plan: PlanId,
  ): Promise<{ plan: PlanId }> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      await client.query(`UPDATE workspaces SET plan = $2 WHERE id = $1`, [
        workspaceId,
        plan,
      ]);
    });
    return { plan };
  }

  private async storageUsed(client: PoolClient, workspaceId: string): Promise<number> {
    const res = await client.query(
      `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS bytes
         FROM files WHERE workspace_id = $1`,
      [workspaceId],
    );
    return Number(res.rows[0]?.bytes ?? 0);
  }

  private async automationsThisMonth(
    client: PoolClient,
    workspaceId: string,
  ): Promise<number> {
    const res = await client.query(
      `SELECT count(*)::int AS n
         FROM automation_runs
        WHERE workspace_id = $1
          AND created_at >= date_trunc('month', now())`,
      [workspaceId],
    );
    return (res.rows[0]?.n as number) ?? 0;
  }

  /** The workspace's current plan (standalone transaction, for GET /plans). */
  async currentPlan(workspaceId: string, userId: string): Promise<PlanId> {
    return this.db.withWorkspace(workspaceId, userId, (client) =>
      this.planId(client, workspaceId),
    );
  }

  /** Full usage report for the settings/usage surface. */
  async usage(workspaceId: string, userId: string): Promise<UsageReport> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const limits = await this.limitsFor(client, workspaceId);
      const storageUsed = await this.storageUsed(client, workspaceId);
      const autoUsed = await this.automationsThisMonth(client, workspaceId);
      const periodRes = await client.query(
        `SELECT date_trunc('month', now()) AS start`,
      );
      const storage = meter(storageUsed, limits.storageBytes);
      const automations = meter(autoUsed, limits.automationsPerMonth);
      return {
        storage: { ...storage, usedBytes: storageUsed, limitBytes: limits.storageBytes },
        automations: {
          ...automations,
          periodStart: (periodRes.rows[0].start as Date).toISOString(),
        },
      };
    });
  }

  /**
   * Reject an upload that would push the workspace past its storage cap.
   * Runs inside the upload transaction so the SUM reflects concurrent commits.
   */
  async assertStorageAvailable(
    client: PoolClient,
    workspaceId: string,
    additionalBytes: number,
  ): Promise<void> {
    const limits = await this.limitsFor(client, workspaceId);
    const used = await this.storageUsed(client, workspaceId);
    if (used + additionalBytes > limits.storageBytes) {
      throw new PayloadTooLargeException(
        "This upload would exceed the workspace storage limit",
      );
    }
  }

  /** True while the workspace is still under its monthly automation cap. */
  async automationQuotaAvailable(
    client: PoolClient,
    workspaceId: string,
  ): Promise<boolean> {
    const limits = await this.limitsFor(client, workspaceId);
    const used = await this.automationsThisMonth(client, workspaceId);
    return used < limits.automationsPerMonth;
  }

  /** Throw when the monthly automation cap is already reached. */
  async assertAutomationQuota(
    client: PoolClient,
    workspaceId: string,
  ): Promise<void> {
    if (!(await this.automationQuotaAvailable(client, workspaceId))) {
      throw new ForbiddenException(
        "Monthly automation run limit reached for this workspace",
      );
    }
  }
}
