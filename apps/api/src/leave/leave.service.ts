import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { DbService } from "../db/db.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../events/events.service";
import { requireName, requireUuid, validColor } from "../tasks/tasks.support";

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveType {
  id: string;
  name: string;
  daysPerYear: number;
  color: string;
  position: number;
}

export interface LeaveRequestOut {
  id: string;
  userId: string;
  userName: string;
  userAvatarUrl: string | null;
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeColor: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  decidedBy: string | null;
  decidedByName: string | null;
  decisionNote: string;
  createdAt: string;
  /** Whether the CALLER may decide this request (admin or requester's head). */
  canDecide: boolean;
}

export interface LeaveBalance {
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeColor: string;
  entitlementDays: number;
  usedDays: number;
  pendingDays: number;
}

/** Mon–Fri days in [start, end], both inclusive (dates as YYYY-MM-DD). */
export function workingDaysBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  let n = 0;
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

function validDate(v: unknown, label: string): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new BadRequestException(`${label} must be a YYYY-MM-DD date`);
  }
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`${label} is not a valid date`);
  }
  return v;
}

const REQUEST_SELECT = `
  SELECT r.id, r.user_id, r.leave_type_id, r.start_date::text, r.end_date::text,
         r.days, r.reason, r.status, r.decided_by, r.decision_note,
         r.created_at, u.full_name AS user_name, u.avatar_url AS user_avatar,
         t.name AS type_name, t.color AS type_color,
         du.full_name AS decided_by_name
  FROM leave_requests r
  JOIN users u ON u.id = r.user_id
  JOIN leave_types t ON t.id = r.leave_type_id
  LEFT JOIN users du ON du.id = r.decided_by`;

/**
 * Leave management (HR module). Types define the policy; requests flow
 * pending → approved/rejected (admin or the requester's department head) or
 * cancelled; balances are computed from approved working days per year.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  private publish(workspaceId: string): void {
    this.events.publish(workspaceId, { type: "leave.changed", payload: {} });
  }

  /** Department ids the user HEADS (empty when none). */
  private async headedDepartmentIds(
    client: PoolClient,
    userId: string,
  ): Promise<string[]> {
    const res = await client.query(
      `SELECT department_id FROM department_members
       WHERE user_id = $1 AND dept_role = 'head'`,
      [userId],
    );
    return res.rows.map((r) => r.department_id as string);
  }

  /** May `approver` decide requests from `requester`? (admin handled outside) */
  private async isHeadOf(
    client: PoolClient,
    approverId: string,
    requesterId: string,
  ): Promise<boolean> {
    const res = await client.query(
      `SELECT 1
       FROM department_members h
       JOIN department_members m ON m.department_id = h.department_id
       WHERE h.user_id = $1 AND h.dept_role = 'head' AND m.user_id = $2
       LIMIT 1`,
      [approverId, requesterId],
    );
    return !!res.rows[0];
  }

  private toRequest(
    r: Record<string, unknown>,
    canDecide: boolean,
  ): LeaveRequestOut {
    return {
      id: r.id as string,
      userId: r.user_id as string,
      userName: r.user_name as string,
      userAvatarUrl: (r.user_avatar as string | null) ?? null,
      leaveTypeId: r.leave_type_id as string,
      leaveTypeName: r.type_name as string,
      leaveTypeColor: r.type_color as string,
      startDate: r.start_date as string,
      endDate: r.end_date as string,
      days: r.days as number,
      reason: r.reason as string,
      status: r.status as LeaveStatus,
      decidedBy: (r.decided_by as string | null) ?? null,
      decidedByName: (r.decided_by_name as string | null) ?? null,
      decisionNote: r.decision_note as string,
      createdAt: (r.created_at as Date).toISOString(),
      canDecide,
    };
  }

  // --- Types ---------------------------------------------------------------

  async listTypes(workspaceId: string, userId: string): Promise<LeaveType[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT id, name, days_per_year, color, position
         FROM leave_types ORDER BY position, created_at`,
      );
      return res.rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        daysPerYear: r.days_per_year as number,
        color: r.color as string,
        position: r.position as number,
      }));
    });
  }

  async createType(
    workspaceId: string,
    userId: string,
    body: { name?: string; daysPerYear?: number; color?: string },
  ): Promise<LeaveType> {
    const name = requireName(body?.name);
    const days = body?.daysPerYear ?? 21;
    if (!Number.isInteger(days) || days < 0 || days > 366) {
      throw new BadRequestException("daysPerYear must be an integer 0–366");
    }
    const color =
      body?.color === undefined || body.color === null
        ? "#7B68EE"
        : validColor(body.color);
    const out = await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const pos = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM leave_types`,
      );
      let res;
      try {
        res = await client.query(
          `INSERT INTO leave_types (workspace_id, name, days_per_year, color, position)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, position`,
          [workspaceId, name, days, color, pos.rows[0].n as number],
        );
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          throw new ConflictException("A leave type with that name already exists");
        }
        throw e;
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "leave_type.created",
        entity: "leave_type",
        entityId: res.rows[0].id as string,
        data: { name, daysPerYear: days },
      });
      return {
        id: res.rows[0].id as string,
        name,
        daysPerYear: days,
        color,
        position: res.rows[0].position as number,
      };
    });
    this.publish(workspaceId);
    return out;
  }

  async updateType(
    workspaceId: string,
    userId: string,
    id: string,
    body: { name?: string; daysPerYear?: number; color?: string },
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    if (body.name !== undefined) {
      params.push(requireName(body.name));
      sets.push(`name = $${params.length}`);
    }
    if (body.daysPerYear !== undefined) {
      if (
        !Number.isInteger(body.daysPerYear) ||
        body.daysPerYear < 0 ||
        body.daysPerYear > 366
      ) {
        throw new BadRequestException("daysPerYear must be an integer 0–366");
      }
      params.push(body.daysPerYear);
      sets.push(`days_per_year = $${params.length}`);
    }
    if (body.color !== undefined) {
      params.push(validColor(body.color));
      sets.push(`color = $${params.length}`);
    }
    if (sets.length === 0) throw new BadRequestException("Nothing to update");
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      let res;
      try {
        res = await client.query(
          `UPDATE leave_types SET ${sets.join(", ")} WHERE id = $1 RETURNING id`,
          params,
        );
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          throw new ConflictException("A leave type with that name already exists");
        }
        throw e;
      }
      if (!res.rows[0]) throw new NotFoundException("Leave type not found");
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "leave_type.updated",
        entity: "leave_type",
        entityId: id,
        data: { ...body },
      });
    });
    this.publish(workspaceId);
  }

  async removeType(workspaceId: string, userId: string, id: string): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `DELETE FROM leave_types WHERE id = $1 RETURNING name`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException("Leave type not found");
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "leave_type.deleted",
        entity: "leave_type",
        entityId: id,
        data: { name: res.rows[0].name as string },
      });
    });
    this.publish(workspaceId);
  }

  // --- Requests ------------------------------------------------------------

  async createRequest(
    workspaceId: string,
    userId: string,
    body: {
      leaveTypeId?: string;
      startDate?: string;
      endDate?: string;
      reason?: string;
    },
  ): Promise<LeaveRequestOut> {
    const leaveTypeId = requireUuid(body?.leaveTypeId, "leaveTypeId");
    const startDate = validDate(body?.startDate, "startDate");
    const endDate = validDate(body?.endDate, "endDate");
    if (endDate < startDate) {
      throw new BadRequestException("endDate must be on or after startDate");
    }
    const days = workingDaysBetween(startDate, endDate);
    if (days === 0) {
      throw new BadRequestException("The range contains no working days");
    }
    if (days > 366) {
      throw new BadRequestException("Leave cannot exceed a year");
    }
    const reason =
      typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";

    const out = await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const type = await client.query(
        `SELECT id FROM leave_types WHERE id = $1`,
        [leaveTypeId],
      );
      if (!type.rows[0]) throw new BadRequestException("Unknown leave type");
      const overlap = await client.query(
        `SELECT 1 FROM leave_requests
         WHERE user_id = $1 AND status IN ('pending', 'approved')
           AND NOT (end_date < $2::date OR start_date > $3::date)
         LIMIT 1`,
        [userId, startDate, endDate],
      );
      if (overlap.rows[0]) {
        throw new ConflictException(
          "You already have leave overlapping those dates",
        );
      }
      const res = await client.query(
        `INSERT INTO leave_requests
           (workspace_id, user_id, leave_type_id, start_date, end_date, days, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [workspaceId, userId, leaveTypeId, startDate, endDate, days, reason],
      );
      const id = res.rows[0].id as string;
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "leave.requested",
        entity: "leave_request",
        entityId: id,
        data: { leaveTypeId, startDate, endDate, days },
      });
      const row = await client.query(`${REQUEST_SELECT} WHERE r.id = $1`, [id]);
      return this.toRequest(row.rows[0], false);
    });
    this.publish(workspaceId);
    return out;
  }

  /**
   * Requests visible to the caller: always their own; plus, with
   * scope='approvals', the pending requests they may decide (admins: all
   * pending; department heads: their departments' members).
   */
  async listRequests(
    workspaceId: string,
    userId: string,
    role: Role,
    scope: "mine" | "approvals",
  ): Promise<LeaveRequestOut[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const isAdmin = role === "owner" || role === "admin";
      if (scope === "mine") {
        const res = await client.query(
          `${REQUEST_SELECT} WHERE r.user_id = $1
           ORDER BY r.created_at DESC LIMIT 200`,
          [userId],
        );
        return res.rows.map((r) => this.toRequest(r, false));
      }
      if (isAdmin) {
        const res = await client.query(
          `${REQUEST_SELECT} WHERE r.status = 'pending' AND r.user_id <> $1
           ORDER BY r.start_date LIMIT 200`,
          [userId],
        );
        return res.rows.map((r) => this.toRequest(r, true));
      }
      const headed = await this.headedDepartmentIds(client, userId);
      if (headed.length === 0) return [];
      const res = await client.query(
        `${REQUEST_SELECT}
         WHERE r.status = 'pending' AND r.user_id <> $1
           AND EXISTS (
             SELECT 1 FROM department_members dm
             WHERE dm.user_id = r.user_id
               AND dm.department_id = ANY($2::uuid[])
           )
         ORDER BY r.start_date LIMIT 200`,
        [userId, headed],
      );
      return res.rows.map((r) => this.toRequest(r, true));
    });
  }

  async decide(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: { approve?: boolean; note?: string },
  ): Promise<void> {
    if (typeof body?.approve !== "boolean") {
      throw new BadRequestException("approve must be true or false");
    }
    const note =
      typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const cur = await client.query(
        `SELECT user_id, status FROM leave_requests WHERE id = $1`,
        [id],
      );
      if (!cur.rows[0]) throw new NotFoundException("Request not found");
      const requesterId = cur.rows[0].user_id as string;
      if (requesterId === userId) {
        throw new ForbiddenException("You can't decide your own request");
      }
      if (cur.rows[0].status !== "pending") {
        throw new BadRequestException("Only pending requests can be decided");
      }
      const isAdmin = role === "owner" || role === "admin";
      if (!isAdmin && !(await this.isHeadOf(client, userId, requesterId))) {
        throw new ForbiddenException(
          "Only admins or the member's department head can decide",
        );
      }
      const status: LeaveStatus = body.approve ? "approved" : "rejected";
      await client.query(
        `UPDATE leave_requests
         SET status = $1, decided_by = $2, decided_at = now(), decision_note = $3
         WHERE id = $4`,
        [status, userId, note, id],
      );
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: body.approve ? "leave.approved" : "leave.rejected",
        entity: "leave_request",
        entityId: id,
        data: { requesterId, ...(note ? { note } : {}) },
      });
    });
    this.publish(workspaceId);
  }

  async cancel(workspaceId: string, userId: string, id: string): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `UPDATE leave_requests SET status = 'cancelled'
         WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'approved')
         RETURNING id`,
        [id, userId],
      );
      if (!res.rows[0]) {
        throw new NotFoundException("No cancellable request found");
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "leave.cancelled",
        entity: "leave_request",
        entityId: id,
      });
    });
    this.publish(workspaceId);
  }

  // --- Balances & who's away ----------------------------------------------

  async balances(
    workspaceId: string,
    userId: string,
    year: number,
  ): Promise<LeaveBalance[]> {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException("year must be a 4-digit year");
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT t.id, t.name, t.color, t.days_per_year,
                COALESCE(SUM(r.days) FILTER (WHERE r.status = 'approved'), 0)::int AS used,
                COALESCE(SUM(r.days) FILTER (WHERE r.status = 'pending'), 0)::int AS pending
         FROM leave_types t
         LEFT JOIN leave_requests r
           ON r.leave_type_id = t.id AND r.user_id = $1
          AND EXTRACT(YEAR FROM r.start_date) = $2
         GROUP BY t.id, t.name, t.color, t.days_per_year, t.position
         ORDER BY t.position`,
        [userId, year],
      );
      return res.rows.map((r) => ({
        leaveTypeId: r.id as string,
        leaveTypeName: r.name as string,
        leaveTypeColor: r.color as string,
        entitlementDays: r.days_per_year as number,
        usedDays: r.used as number,
        pendingDays: r.pending as number,
      }));
    });
  }

  /** Approved leave overlapping [from, to] — the "who's away" board. */
  async away(
    workspaceId: string,
    userId: string,
    from: string,
    to: string,
  ): Promise<LeaveRequestOut[]> {
    validDate(from, "from");
    validDate(to, "to");
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `${REQUEST_SELECT}
         WHERE r.status = 'approved'
           AND NOT (r.end_date < $1::date OR r.start_date > $2::date)
         ORDER BY r.start_date LIMIT 200`,
        [from, to],
      );
      return res.rows.map((r) => this.toRequest(r, false));
    });
  }
}
