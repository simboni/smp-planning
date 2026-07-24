import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  DEPARTMENT_KINDS,
  type DepartmentKind,
  type Role,
} from "@stackup/shared";
import { DbService } from "../db/db.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../events/events.service";
import { HierarchyService } from "../hierarchy/hierarchy.service";
import { TasksService } from "../tasks/tasks.service";
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
  kind: DepartmentKind;
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

export type OnboardingAssigneeKind = "new_member" | "head" | "specific";

export interface OnboardingStep {
  id: string;
  title: string;
  assigneeKind: OnboardingAssigneeKind;
  assigneeUserId: string | null;
  dueDays: number;
  position: number;
}

/** What happened when onboarding ran for a newly added member. */
export interface OnboardingResult {
  /** Tasks created in the department's Onboarding list. */
  created: number;
  /** Why nothing was created, when applicable. */
  skipped?: "no_steps" | "no_space";
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

function validKind(v: unknown): DepartmentKind {
  if (v === undefined || v === null) return "general";
  if (
    typeof v !== "string" ||
    !(DEPARTMENT_KINDS as readonly string[]).includes(v)
  ) {
    throw new BadRequestException(
      `kind must be one of: ${DEPARTMENT_KINDS.join(", ")}`,
    );
  }
  return v as DepartmentKind;
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
    private readonly hierarchy: HierarchyService,
    private readonly tasks: TasksService,
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
      SELECT d.id, d.name, d.description, d.color, d.kind, d.space_id,
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
      kind: (r.kind as DepartmentKind) ?? "general",
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

  /**
   * The whole workspace's department roster in one query — who belongs to
   * which department — so the HR directory can join people to departments
   * client-side without N detail calls.
   */
  async roster(
    workspaceId: string,
    userId: string,
  ): Promise<{ departmentId: string; userId: string; deptRole: DeptRole }[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT department_id, user_id, dept_role FROM department_members`,
      );
      return res.rows.map((r) => ({
        departmentId: r.department_id as string,
        userId: r.user_id as string,
        deptRole: r.dept_role as DeptRole,
      }));
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
      kind?: string;
      leadUserId?: string | null;
      createSpace?: boolean;
    },
  ): Promise<DepartmentSummary> {
    const name = requireName(body?.name);
    const description = validDescription(body?.description);
    const kind = validKind(body?.kind);
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
             (workspace_id, name, description, color, kind, lead_user_id, sort_order, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [workspaceId, name, description, color, kind, leadUserId, pos.rows[0].n as number, userId],
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
      kind?: string;
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
      if (body.kind !== undefined) {
        params.push(validKind(body.kind));
        sets.push(`kind = $${params.length}`);
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

  // --- Onboarding checklists ---------------------------------------------

  async getOnboarding(
    workspaceId: string,
    userId: string,
    departmentId: string,
  ): Promise<OnboardingStep[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.load(client, departmentId);
      const res = await client.query(
        `SELECT id, title, assignee_kind, assignee_user_id, due_days, position
         FROM department_onboarding_steps
         WHERE department_id = $1
         ORDER BY position, created_at`,
        [departmentId],
      );
      return res.rows.map((r) => ({
        id: r.id as string,
        title: r.title as string,
        assigneeKind: r.assignee_kind as OnboardingAssigneeKind,
        assigneeUserId: (r.assignee_user_id as string | null) ?? null,
        dueDays: r.due_days as number,
        position: r.position as number,
      }));
    });
  }

  /** Replace the department's onboarding checklist wholesale (admin). */
  async setOnboarding(
    workspaceId: string,
    userId: string,
    departmentId: string,
    stepsIn: unknown,
  ): Promise<OnboardingStep[]> {
    if (!Array.isArray(stepsIn) || stepsIn.length > 50) {
      throw new BadRequestException("steps must be an array of at most 50");
    }
    const steps = stepsIn.map((raw, i) => {
      const s = (raw ?? {}) as Record<string, unknown>;
      const title = requireName(s.title, "step title");
      const kind = s.assigneeKind ?? "new_member";
      if (kind !== "new_member" && kind !== "head" && kind !== "specific") {
        throw new BadRequestException(
          "assigneeKind must be 'new_member', 'head' or 'specific'",
        );
      }
      const assigneeUserId =
        kind === "specific"
          ? requireUuid(s.assigneeUserId, "assigneeUserId")
          : null;
      const dueDays =
        s.dueDays === undefined || s.dueDays === null ? 7 : Number(s.dueDays);
      if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) {
        throw new BadRequestException("dueDays must be an integer 0–365");
      }
      return {
        title,
        assigneeKind: kind as OnboardingAssigneeKind,
        assigneeUserId,
        dueDays,
        position: i,
      };
    });
    const out = await this.db.withWorkspace(workspaceId, userId, async (client) => {
      await this.load(client, departmentId);
      for (const s of steps) {
        if (s.assigneeUserId) {
          await this.assertMember(client, s.assigneeUserId, "assigneeUserId");
        }
      }
      await client.query(
        `DELETE FROM department_onboarding_steps WHERE department_id = $1`,
        [departmentId],
      );
      const created: OnboardingStep[] = [];
      for (const s of steps) {
        const res = await client.query(
          `INSERT INTO department_onboarding_steps
             (workspace_id, department_id, title, assignee_kind, assignee_user_id, due_days, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            workspaceId,
            departmentId,
            s.title,
            s.assigneeKind,
            s.assigneeUserId,
            s.dueDays,
            s.position,
          ],
        );
        created.push({ id: res.rows[0].id as string, ...s });
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "department.onboarding_updated",
        entity: "department",
        entityId: departmentId,
        data: { steps: steps.length },
      });
      return created;
    });
    this.publishChanged(workspaceId, departmentId);
    return out;
  }

  /**
   * Turn the department's onboarding checklist into real tasks for a newly
   * added member: an "Onboarding" list in the department's home Space (found
   * or created), one task per step, assigned per the step's rule and dated
   * join-date + dueDays. Runs AFTER the roster insert commits — a task
   * failure never undoes the membership; whatever was created is reported.
   */
  private async runOnboarding(
    workspaceId: string,
    actorUserId: string,
    role: Role,
    departmentId: string,
    targetUserId: string,
  ): Promise<OnboardingResult> {
    const setup = await this.db.withWorkspace(
      workspaceId,
      actorUserId,
      async (client) => {
        const dept = await this.load(client, departmentId);
        const steps = await client.query(
          `SELECT title, assignee_kind, assignee_user_id, due_days
           FROM department_onboarding_steps
           WHERE department_id = $1
           ORDER BY position, created_at`,
          [departmentId],
        );
        const person = await client.query(
          `SELECT full_name, email FROM users WHERE id = $1`,
          [targetUserId],
        );
        let listId: string | null = null;
        if (dept.space_id) {
          const list = await client.query(
            `SELECT id FROM lists
             WHERE space_id = $1 AND folder_id IS NULL AND name = 'Onboarding'
               AND archived = false
             ORDER BY created_at LIMIT 1`,
            [dept.space_id],
          );
          listId = (list.rows[0]?.id as string | undefined) ?? null;
        }
        return {
          spaceId: dept.space_id,
          leadUserId: dept.lead_user_id,
          listId,
          personName:
            (person.rows[0]?.full_name as string | undefined) ||
            (person.rows[0]?.email as string | undefined) ||
            "New member",
          steps: steps.rows as {
            title: string;
            assignee_kind: OnboardingAssigneeKind;
            assignee_user_id: string | null;
            due_days: number;
          }[],
        };
      },
    );

    if (setup.steps.length === 0) return { created: 0, skipped: "no_steps" };
    if (!setup.spaceId) return { created: 0, skipped: "no_space" };

    let listId = setup.listId;
    if (!listId) {
      const list = await this.hierarchy.createList(
        workspaceId,
        actorUserId,
        role,
        setup.spaceId,
        { name: "Onboarding" },
      );
      listId = list.id;
    }

    let created = 0;
    for (const step of setup.steps) {
      const assignee =
        step.assignee_kind === "new_member"
          ? targetUserId
          : step.assignee_kind === "head"
            ? (setup.leadUserId ?? targetUserId)
            : step.assignee_user_id;
      const due = new Date();
      due.setDate(due.getDate() + step.due_days);
      try {
        await this.tasks.createTask(workspaceId, actorUserId, role, listId, {
          name: `${step.title} — ${setup.personName}`,
          assigneeIds: assignee ? [assignee] : [],
          dueDate: due.toISOString().slice(0, 10),
          description: `Onboarding step for ${setup.personName}.`,
        });
        created += 1;
      } catch {
        // A single bad step (e.g. assignee no longer a member) must not
        // abort the rest of the checklist.
      }
    }
    await this.db.withWorkspace(workspaceId, actorUserId, async (client) => {
      await this.audit.record(client, {
        workspaceId,
        actorUserId,
        action: "department.onboarding_started",
        entity: "department",
        entityId: departmentId,
        data: { targetUserId, created },
      });
    });
    return { created };
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
    actorRole: Role,
    departmentId: string,
    body: {
      userId?: string;
      email?: string;
      role?: Role;
      title?: string | null;
      deptRole?: string;
    },
  ): Promise<{ member: DepartmentMemberOut; onboarding: OnboardingResult }> {
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
    const onboarding = await this.runOnboarding(
      workspaceId,
      actorUserId,
      actorRole,
      departmentId,
      targetUserId,
    );
    this.publishChanged(workspaceId, departmentId);
    return { member: out, onboarding };
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
