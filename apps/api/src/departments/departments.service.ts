import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { DbService } from "../db/db.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../events/events.service";
import {
  WorkspacesService,
  normalizeTitle,
} from "../workspaces/workspaces.service";
import { requireName, requireUuid, validColor } from "../tasks/tasks.support";

const DEFAULT_COLOR = "#7B68EE";

export type DeptRole = "head" | "member";

export interface DepartmentLead {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface DepartmentSummary {
  id: string;
  name: string;
  description: string;
  color: string;
  lead: DepartmentLead | null;
  spaceId: string | null;
  spaceName: string | null;
  memberCount: number;
}

export interface DepartmentMemberOut {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  deptRole: DeptRole;
  role: Role;
  status: string;
  title: string | null;
}

export interface DepartmentDetail extends DepartmentSummary {
  members: DepartmentMemberOut[];
}

function validDescription(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") {
    throw new BadRequestException("description must be a string");
  }
  const trimmed = v.trim();
  if (trimmed.length > 500) {
    throw new BadRequestException("description must be 500 characters or fewer");
  }
  return trimmed;
}

function validDeptRole(v: unknown): DeptRole {
  if (v === undefined || v === null) return "member";
  if (v !== "head" && v !== "member") {
    throw new BadRequestException("deptRole must be 'head' or 'member'");
  }
  return v;
}

/**
 * Module HR — departments, designations and org onboarding.
 *
 * Departments are org units: a name, a head, a roster of workspace members
 * (each with an org-wide designation stored on their membership), and
 * optionally a private home Space the whole department can work in. The
 * space link rides on the existing shares table with a 'department'
 * principal, so joining a department is all it takes to see its space.
 */
@Injectable()
export class DepartmentsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly workspaces: WorkspacesService,
  ) {}

  private publishChanged(workspaceId: string, departmentId: string): void {
    this.events.publish(workspaceId, {
      type: "department.changed",
      payload: { departmentId },
    });
  }

  /** The department row, or 404. */
  private async load(
    client: PoolClient,
    id: string,
  ): Promise<{
    id: string;
    name: string;
    description: string;
    color: string;
    lead_user_id: string | null;
    space_id: string | null;
  }> {
    const res = await client.query(
      `SELECT id, name, description, color, lead_user_id, space_id
       FROM departments WHERE id = $1`,
      [id],
    );
    if (!res.rows[0]) throw new NotFoundException("Department not found");
    return res.rows[0];
  }

  /** Assert the user is an active workspace member (for lead / roster adds). */
  private async assertMember(
    client: PoolClient,
    userId: string,
    label: string,
  ): Promise<void> {
    const res = await client.query(
      `SELECT 1 FROM memberships WHERE user_id = $1`,
      [userId],
    );
    if (!res.rows[0]) {
      throw new BadRequestException(`${label} is not a member of this workspace`);
    }
  }

  private summaryQuery(where: string): string {
    return `
      SELECT d.id, d.name, d.description, d.color, d.space_id,
             s.name AS space_name,
             l.id AS lead_id, l.full_name AS lead_name, l.avatar_url AS lead_avatar,
             (SELECT COUNT(*)::int FROM department_members dm
               WHERE dm.department_id = d.id) AS member_count
      FROM departments d
      LEFT JOIN users l ON l.id = d.lead_user_id
      LEFT JOIN spaces s ON s.id = d.space_id
      ${where}
      ORDER BY d.sort_order, d.created_at`;
  }

  private toSummary(r: Record<string, unknown>): DepartmentSummary {
    return {
      id: r.id as string,
      name: r.name as string,
      description: r.description as string,
      color: r.color as string,
      lead: r.lead_id
        ? {
            id: r.lead_id as string,
            fullName: r.lead_name as string,
            avatarUrl: (r.lead_avatar as string | null) ?? null,
          }
        : null,
      spaceId: (r.space_id as string | null) ?? null,
      spaceName: (r.space_name as string | null) ?? null,
      memberCount: r.member_count as number,
    };
  }

  async list(workspaceId: string, userId: string): Promise<DepartmentSummary[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(this.summaryQuery(""));
      return res.rows.map((r) => this.toSummary(r));
    });
  }

  async get(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<DepartmentDetail> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(this.summaryQuery("WHERE d.id = $1"), [id]);
      if (!res.rows[0]) throw new NotFoundException("Department not found");
      const members = await client.query(
        `SELECT dm.user_id, dm.dept_role, u.full_name, u.email, u.avatar_url,
                m.role, m.status, m.title
         FROM department_members dm
         JOIN users u ON u.id = dm.user_id
         JOIN memberships m ON m.user_id = dm.user_id
         WHERE dm.department_id = $1
         ORDER BY (dm.dept_role = 'head') DESC, dm.created_at`,
        [id],
      );
      return {
        ...this.toSummary(res.rows[0]),
        members: members.rows.map((r) => ({
          userId: r.user_id as string,
          fullName: r.full_name as string,
          email: r.email as string,
          avatarUrl: (r.avatar_url as string | null) ?? null,
          deptRole: r.dept_role as DeptRole,
          role: r.role as Role,
          status: r.status as string,
          title: (r.title as string | null) ?? null,
        })),
      };
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    body: {
      name?: string;
      description?: string;
      color?: string;
      leadUserId?: string | null;
      createSpace?: boolean;
    },
  ): Promise<DepartmentSummary> {
    const name = requireName(body?.name);
    const description = validDescription(body?.description);
    const color =
      body?.color === undefined || body.color === null
        ? DEFAULT_COLOR
        : validColor(body.color);
    const leadUserId = body?.leadUserId
      ? requireUuid(body.leadUserId, "leadUserId")
      : null;
    const createSpace = body?.createSpace === true;

    const dept = await this.db.withWorkspace(workspaceId, userId, async (client) => {
      if (leadUserId) await this.assertMember(client, leadUserId, "leadUserId");
      const pos = await client.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM departments`,
      );
      let res;
      try {
        res = await client.query(
          `INSERT INTO departments
             (workspace_id, name, description, color, lead_user_id, sort_order, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [workspaceId, name, description, color, leadUserId, pos.rows[0].n as number, userId],
        );
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          throw new ConflictException("A department with that name already exists");
        }
        throw e;
      }
      const id = res.rows[0].id as string;

      let spaceId: string | null = null;
      if (createSpace) {
        // The department's private home Space, created in the same
        // transaction. The department-principal share is what makes it
        // visible to (exactly) the department's roster; the creator is an
        // owner/admin (route guard) so they see it regardless.
        const spos = await client.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM spaces`,
        );
        const sres = await client.query(
          `INSERT INTO spaces (workspace_id, name, color, icon, is_private, sort_order, created_by)
           VALUES ($1, $2, $3, NULL, true, $4, $5)
           RETURNING id`,
          [workspaceId, name, color, spos.rows[0].n as number, userId],
        );
        spaceId = sres.rows[0].id as string;
        await client.query(
          `UPDATE departments SET space_id = $1 WHERE id = $2`,
          [spaceId, id],
        );
        await client.query(
          `INSERT INTO shares
             (workspace_id, object_type, object_id, principal_type, principal_id, permission, created_by)
           VALUES ($1, 'space', $2, 'department', $3, 'edit', $4)
           ON CONFLICT (object_type, object_id, principal_type, principal_id) DO NOTHING`,
          [workspaceId, spaceId, id, userId],
        );
        await this.audit.record(client, {
          workspaceId,
          actorUserId: userId,
          action: "space.created",
          entity: "space",
          entityId: spaceId,
          data: { name, department: true },
        });
      }

      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "department.created",
        entity: "department",
        entityId: id,
        data: { name, ...(spaceId ? { spaceId } : {}) },
      });

      const out = await client.query(this.summaryQuery("WHERE d.id = $1"), [id]);
      return this.toSummary(out.rows[0]);
    });
    this.publishChanged(workspaceId, dept.id);
    return dept;
  }

  async update(
    workspaceId: string,
    userId: string,
    id: string,
    body: {
      name?: string;
      description?: string;
      color?: string;
      leadUserId?: string | null;
      spaceId?: string | null;
    },
  ): Promise<DepartmentSummary> {
    const dept = await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const cur = await this.load(client, id);

      const sets: string[] = [];
      const params: unknown[] = [id];
      if (body.name !== undefined) {
        params.push(requireName(body.name));
        sets.push(`name = $${params.length}`);
      }
      if (body.description !== undefined) {
        params.push(validDescription(body.description));
        sets.push(`description = $${params.length}`);
      }
      if (body.color !== undefined) {
        params.push(validColor(body.color));
        sets.push(`color = $${params.length}`);
      }
      if (body.leadUserId !== undefined) {
        const lead = body.leadUserId
          ? requireUuid(body.leadUserId, "leadUserId")
          : null;
        if (lead) await this.assertMember(client, lead, "leadUserId");
        params.push(lead);
        sets.push(`lead_user_id = $${params.length}`);
      }
      if (body.spaceId !== undefined) {
        const nextSpaceId = body.spaceId
          ? requireUuid(body.spaceId, "spaceId")
          : null;
        if (nextSpaceId) {
          const sp = await client.query(`SELECT 1 FROM spaces WHERE id = $1`, [
            nextSpaceId,
          ]);
          if (!sp.rows[0]) throw new BadRequestException("space does not exist");
        }
        if (nextSpaceId !== cur.space_id) {
          // Keep the department share in step with the linked space.
          if (cur.space_id) {
            await client.query(
              `DELETE FROM shares
               WHERE object_type = 'space' AND object_id = $1
                 AND principal_type = 'department' AND principal_id = $2`,
              [cur.space_id, id],
            );
          }
          if (nextSpaceId) {
            await client.query(
              `INSERT INTO shares
                 (workspace_id, object_type, object_id, principal_type, principal_id, permission, created_by)
               VALUES ($1, 'space', $2, 'department', $3, 'edit', $4)
               ON CONFLICT (object_type, object_id, principal_type, principal_id)
               DO UPDATE SET permission = 'edit'`,
              [workspaceId, nextSpaceId, id, userId],
            );
          }
        }
        params.push(nextSpaceId);
        sets.push(`space_id = $${params.length}`);
      }
      if (sets.length === 0) throw new BadRequestException("Nothing to update");

      try {
        await client.query(
          `UPDATE departments SET ${sets.join(", ")} WHERE id = $1`,
          params,
        );
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          throw new ConflictException("A department with that name already exists");
        }
        throw e;
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "department.updated",
        entity: "department",
        entityId: id,
        data: { ...body },
      });
      const out = await client.query(this.summaryQuery("WHERE d.id = $1"), [id]);
      return this.toSummary(out.rows[0]);
    });
    this.publishChanged(workspaceId, id);
    return dept;
  }

  async remove(workspaceId: string, userId: string, id: string): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const cur = await this.load(client, id);
      // The department's share grants die with it; a linked space survives
      // (it may hold real work) and simply stops being department-visible.
      await client.query(
        `DELETE FROM shares WHERE principal_type = 'department' AND principal_id = $1`,
        [id],
      );
      await client.query(`DELETE FROM departments WHERE id = $1`, [id]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "department.deleted",
        entity: "department",
        entityId: id,
        data: { name: cur.name },
      });
    });
    this.publishChanged(workspaceId, id);
  }

  /**
   * Add someone to a department. Two paths:
   *  - `userId`: an existing workspace member joins the department.
   *  - `email`: full onboarding — if the address isn't a workspace member
   *    yet they are invited (with the given workspace role, default
   *    'member') and land directly in the department.
   * An optional `title` sets the person's designation, and `deptRole`
   * 'head' marks a department head.
   */
  async addMember(
    workspaceId: string,
    actorUserId: string,
    departmentId: string,
    body: {
      userId?: string;
      email?: string;
      role?: Role;
      title?: string | null;
      deptRole?: string;
    },
  ): Promise<DepartmentMemberOut> {
    const deptRole = validDeptRole(body?.deptRole);
    const title = body?.title === undefined ? undefined : normalizeTitle(body.title);

    let targetUserId: string;
    if (body?.userId) {
      targetUserId = requireUuid(body.userId, "userId");
    } else if (typeof body?.email === "string" && body.email.trim()) {
      const email = body.email.trim();
      const role = body?.role;
      if (role !== undefined && !["admin", "member", "guest"].includes(role)) {
        throw new BadRequestException(
          "role must be 'admin', 'member' or 'guest'",
        );
      }
      // Already a member? Use them; otherwise onboard them into the
      // workspace first (invite + designation in one step).
      const existing = await this.db.withWorkspace(
        workspaceId,
        actorUserId,
        async (client) => {
          const res = await client.query(
            `SELECT m.user_id FROM memberships m
             JOIN users u ON u.id = m.user_id
             WHERE lower(u.email) = lower($1)`,
            [email],
          );
          return (res.rows[0]?.user_id as string | undefined) ?? null;
        },
      );
      if (existing) {
        targetUserId = existing;
      } else {
        const member = await this.workspaces.addMember(
          workspaceId,
          actorUserId,
          email,
          role ?? "member",
          title ?? null,
        );
        targetUserId = member.id;
      }
    } else {
      throw new BadRequestException("userId or email is required");
    }

    const out = await this.db.withWorkspace(
      workspaceId,
      actorUserId,
      async (client) => {
        await this.load(client, departmentId);
        await this.assertMember(client, targetUserId, "userId");
        const ins = await client.query(
          `INSERT INTO department_members (workspace_id, department_id, user_id, dept_role)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (department_id, user_id) DO NOTHING
           RETURNING id`,
          [workspaceId, departmentId, targetUserId, deptRole],
        );
        if (!ins.rows[0]) {
          throw new ConflictException("Already in this department");
        }
        if (title !== undefined) {
          await client.query(
            `UPDATE memberships SET title = $1 WHERE user_id = $2`,
            [title, targetUserId],
          );
        }
        await this.audit.record(client, {
          workspaceId,
          actorUserId,
          action: "department.member_added",
          entity: "department",
          entityId: departmentId,
          data: {
            targetUserId,
            deptRole,
            ...(title !== undefined ? { title } : {}),
          },
        });
        const res = await client.query(
          `SELECT dm.user_id, dm.dept_role, u.full_name, u.email, u.avatar_url,
                  m.role, m.status, m.title
           FROM department_members dm
           JOIN users u ON u.id = dm.user_id
           JOIN memberships m ON m.user_id = dm.user_id
           WHERE dm.department_id = $1 AND dm.user_id = $2`,
          [departmentId, targetUserId],
        );
        const r = res.rows[0];
        return {
          userId: r.user_id as string,
          fullName: r.full_name as string,
          email: r.email as string,
          avatarUrl: (r.avatar_url as string | null) ?? null,
          deptRole: r.dept_role as DeptRole,
          role: r.role as Role,
          status: r.status as string,
          title: (r.title as string | null) ?? null,
        };
      },
    );
    this.publishChanged(workspaceId, departmentId);
    return out;
  }

  async updateMember(
    workspaceId: string,
    actorUserId: string,
    departmentId: string,
    targetUserId: string,
    body: { deptRole?: string; title?: string | null },
  ): Promise<void> {
    const hasDeptRole = body?.deptRole !== undefined;
    const deptRole = hasDeptRole ? validDeptRole(body.deptRole) : undefined;
    const title = body?.title === undefined ? undefined : normalizeTitle(body.title);
    if (!hasDeptRole && title === undefined) {
      throw new BadRequestException("Nothing to update");
    }
    await this.db.withWorkspace(workspaceId, actorUserId, async (client) => {
      await this.load(client, departmentId);
      const cur = await client.query(
        `SELECT 1 FROM department_members WHERE department_id = $1 AND user_id = $2`,
        [departmentId, targetUserId],
      );
      if (!cur.rows[0]) throw new NotFoundException("Not in this department");
      if (deptRole !== undefined) {
        await client.query(
          `UPDATE department_members SET dept_role = $1
           WHERE department_id = $2 AND user_id = $3`,
          [deptRole, departmentId, targetUserId],
        );
      }
      if (title !== undefined) {
        await client.query(
          `UPDATE memberships SET title = $1 WHERE user_id = $2`,
          [title, targetUserId],
        );
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId,
        action: "department.member_updated",
        entity: "department",
        entityId: departmentId,
        data: { targetUserId, ...body },
      });
    });
    this.publishChanged(workspaceId, departmentId);
  }

  async removeMember(
    workspaceId: string,
    actorUserId: string,
    departmentId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.db.withWorkspace(workspaceId, actorUserId, async (client) => {
      await this.load(client, departmentId);
      const res = await client.query(
        `DELETE FROM department_members
         WHERE department_id = $1 AND user_id = $2
         RETURNING id`,
        [departmentId, targetUserId],
      );
      if (!res.rows[0]) throw new NotFoundException("Not in this department");
      await this.audit.record(client, {
        workspaceId,
        actorUserId,
        action: "department.member_removed",
        entity: "department",
        entityId: departmentId,
        data: { targetUserId },
      });
    });
    this.publishChanged(workspaceId, departmentId);
  }
}
