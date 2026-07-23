import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import {
  optionalName,
  requireName,
  requireSpaceEdit,
  requireSpaceVisible,
  requireUuid,
} from "../tasks/tasks.support";
import {
  FormField,
  newPublicToken,
  validateFields,
  validateSubmission,
} from "./forms.support";

export interface FormSummary {
  id: string;
  name: string;
  listId: string;
  listName: string;
  active: boolean;
  publicToken: string;
  fieldCount: number;
  responseCount: number;
  updatedAt: string;
}

/** One reconstructed form response (a task in the form's list). */
export interface FormResponse {
  taskId: string;
  title: string;
  createdAt: string;
  statusName: string | null;
  statusColor: string | null;
  /** Answers keyed by field id (display strings). */
  values: Record<string, string>;
}

export interface FormResponses {
  form: { id: string; name: string; listId: string; fields: FormField[] };
  responses: FormResponse[];
}

export interface FormOut {
  id: string;
  name: string;
  description: string;
  listId: string;
  listName: string;
  active: boolean;
  publicToken: string;
  fields: FormField[];
  createdAt: string;
  updatedAt: string;
}

/** What the unauthenticated fill page may see — never list/workspace ids. */
export interface PublicFormOut {
  name: string;
  description: string;
  fields: FormField[];
}

const MAX_SUBMISSION_BYTES = 32 * 1024;

const FORM_SQL = `
  SELECT f.id, f.name, f.description, f.list_id, f.active, f.public_token,
         f.fields, f.created_at, f.updated_at,
         l.name AS list_name, l.space_id
  FROM forms f
  JOIN lists l ON l.id = f.list_id`;

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Parse a submission task's description ("Label: value" lines, as written by
 * validateSubmission) back into per-field answers. Handles multi-line values:
 * a line only starts a new field when its "key" matches a known field label,
 * otherwise it's appended to the current field's value. Returns whether any
 * line matched a field label (used to tell submissions from manual tasks).
 */
function parseResponseLines(
  description: string,
  fields: FormField[],
): { matched: boolean; values: Record<string, string> } {
  const byLabel = new Map<string, string>(); // lower(label) -> field id
  for (const f of fields) byLabel.set(f.label.trim().toLowerCase(), f.id);

  const values: Record<string, string> = {};
  let matched = false;
  let currentId: string | null = null;

  for (const rawLine of description.split("\n")) {
    const idx = rawLine.indexOf(":");
    let handled = false;
    if (idx > 0) {
      const key = rawLine.slice(0, idx).trim().toLowerCase();
      const fieldId = byLabel.get(key);
      if (fieldId) {
        const val = rawLine.slice(idx + 1).replace(/^\s/, "");
        values[fieldId] = val;
        currentId = fieldId;
        matched = true;
        handled = true;
      }
    }
    if (!handled && currentId) {
      // Continuation of a multi-line answer.
      values[currentId] = `${values[currentId] ?? ""}\n${rawLine}`;
    }
  }
  return { matched, values };
}

function toForm(r: Record<string, unknown>): FormOut {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? "",
    listId: r.list_id as string,
    listName: r.list_name as string,
    active: r.active as boolean,
    publicToken: r.public_token as string,
    fields: (r.fields as FormField[]) ?? [],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/**
 * Module 11: Forms — public intake forms that create tasks in a target list.
 * Management (CRUD, token rotation) requires EDIT permission on the target
 * list's space; listing shows only forms whose space is visible. The public
 * fill/submit path is unauthenticated: it runs under db.withFormToken so RLS
 * admits exactly one form row, and task creation goes through the
 * submit_form_task SECURITY DEFINER function (db/migrations/0012).
 */
@Injectable()
export class FormsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Load a form row + its list (404 when missing). */
  private async formRow(
    client: PoolClient,
    id: string,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(`${FORM_SQL} WHERE f.id = $1`, [id]);
    if (!res.rows[0]) throw new NotFoundException("Form not found");
    return res.rows[0];
  }

  // --- Management (auth'd) --------------------------------------------------

  async listForms(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<FormSummary[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const visible = await this.access.visibleSpaceIds(client, userId, role);
      const res = await client.query(
        `SELECT f.id, f.name, f.list_id, f.active, f.public_token,
                jsonb_array_length(f.fields)::int AS field_count, f.updated_at,
                l.name AS list_name, l.space_id,
                (SELECT count(*) FROM tasks t
                   WHERE t.list_id = f.list_id
                     AND t.parent_task_id IS NULL
                     AND coalesce(t.description, '') <> '')::int AS response_count
         FROM forms f JOIN lists l ON l.id = f.list_id
         ORDER BY f.created_at DESC, f.id`,
      );
      return res.rows
        .filter((r) => visible.has(r.space_id as string))
        .map((r) => ({
          id: r.id as string,
          name: r.name as string,
          listId: r.list_id as string,
          listName: r.list_name as string,
          active: r.active as boolean,
          publicToken: r.public_token as string,
          fieldCount: r.field_count as number,
          responseCount: r.response_count as number,
          updatedAt: iso(r.updated_at),
        }));
    });
  }

  async createForm(
    workspaceId: string,
    userId: string,
    role: Role,
    body: {
      name?: string;
      listId?: string;
      description?: string;
      fields?: unknown;
    },
  ): Promise<FormOut> {
    const name = requireName(body?.name);
    const listId = requireUuid(body?.listId, "listId");
    const description =
      typeof body?.description === "string" ? body.description : "";
    const fields = validateFields(body?.fields ?? []);

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const list = await client.query(
        `SELECT space_id FROM lists WHERE id = $1`,
        [listId],
      );
      if (!list.rows[0]) throw new NotFoundException("List not found");
      await requireSpaceEdit(
        this.access,
        client,
        userId,
        role,
        list.rows[0].space_id as string,
      );

      const token = newPublicToken();
      const ins = await client.query(
        `INSERT INTO forms
           (workspace_id, list_id, name, description, fields, public_token,
            created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          workspaceId,
          listId,
          name,
          description,
          JSON.stringify(fields),
          token,
          userId,
        ],
      );
      const formId = ins.rows[0].id as string;
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "form.created",
        entity: "form",
        entityId: formId,
        data: { name, listId, fieldCount: fields.length },
      });
      return toForm(await this.formRow(client, formId));
    });
  }

  async getForm(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<FormOut> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const row = await this.formRow(client, id);
      await requireSpaceVisible(
        this.access,
        client,
        userId,
        role,
        row.space_id as string,
      );
      return toForm(row);
    });
  }

  /**
   * Reconstruct a form's responses from the tasks it created. Each public
   * submission becomes one task in the form's list whose description is the
   * "Label: value" lines produced at submit time; we parse those back into
   * per-field answers. This needs no extra storage — the tasks ARE the
   * responses — so it works against existing data with no migration. A task
   * counts as a response only when at least one of its lines matches a current
   * field label (excludes blank, manually-added tasks).
   */
  async listResponses(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<FormResponses> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const row = await this.formRow(client, id);
      await requireSpaceVisible(
        this.access,
        client,
        userId,
        role,
        row.space_id as string,
      );
      const fields = (row.fields as FormField[]) ?? [];
      const tasks = await client.query(
        `SELECT t.id, t.name, t.description, t.created_at,
                s.name AS status_name, s.color AS status_color
           FROM tasks t
           LEFT JOIN statuses s ON s.id = t.status_id
          WHERE t.list_id = $1 AND t.parent_task_id IS NULL
          ORDER BY t.created_at DESC, t.id`,
        [row.list_id as string],
      );
      const responses: FormResponse[] = [];
      for (const t of tasks.rows) {
        const parsed = parseResponseLines(
          (t.description as string) ?? "",
          fields,
        );
        if (!parsed.matched) continue; // not a form submission
        responses.push({
          taskId: t.id as string,
          title: t.name as string,
          createdAt: iso(t.created_at),
          statusName: (t.status_name as string) ?? null,
          statusColor: (t.status_color as string) ?? null,
          values: parsed.values,
        });
      }
      return {
        form: {
          id: row.id as string,
          name: row.name as string,
          listId: row.list_id as string,
          fields,
        },
        responses,
      };
    });
  }

  async updateForm(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: {
      name?: string;
      description?: string;
      fields?: unknown;
      active?: boolean;
      listId?: string;
    },
  ): Promise<FormOut> {
    const name = optionalName(body?.name);
    const fields =
      body?.fields !== undefined ? validateFields(body.fields) : undefined;

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.formRow(client, id);
      await requireSpaceEdit(
        this.access,
        client,
        userId,
        role,
        existing.space_id as string,
      );

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(name);
      }
      if (body?.description !== undefined) {
        sets.push(`description = $${i++}`);
        params.push(
          typeof body.description === "string" ? body.description : "",
        );
      }
      if (fields !== undefined) {
        sets.push(`fields = $${i++}`);
        params.push(JSON.stringify(fields));
      }
      if (body?.active !== undefined) {
        if (typeof body.active !== "boolean") {
          throw new BadRequestException("active must be a boolean");
        }
        sets.push(`active = $${i++}`);
        params.push(body.active);
      }
      if (body?.listId !== undefined) {
        const listId = requireUuid(body.listId, "listId");
        const list = await client.query(
          `SELECT space_id FROM lists WHERE id = $1`,
          [listId],
        );
        if (!list.rows[0]) throw new NotFoundException("List not found");
        // Retargeting needs edit on the NEW list's space too.
        await requireSpaceEdit(
          this.access,
          client,
          userId,
          role,
          list.rows[0].space_id as string,
        );
        sets.push(`list_id = $${i++}`);
        params.push(listId);
      }
      if (sets.length > 0) {
        sets.push(`updated_at = now()`);
        params.push(id);
        await client.query(
          `UPDATE forms SET ${sets.join(", ")} WHERE id = $${i}`,
          params,
        );
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "form.updated",
        entity: "form",
        entityId: id,
        data: {
          name,
          active: body?.active,
          listId: body?.listId,
          fieldsChanged: fields !== undefined,
        },
      });
      return toForm(await this.formRow(client, id));
    });
  }

  async deleteForm(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    await this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.formRow(client, id);
      await requireSpaceEdit(
        this.access,
        client,
        userId,
        role,
        existing.space_id as string,
      );
      await client.query(`DELETE FROM forms WHERE id = $1`, [id]);
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "form.deleted",
        entity: "form",
        entityId: id,
        data: { name: existing.name as string },
      });
    });
  }

  async rotateToken(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<string> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const existing = await this.formRow(client, id);
      await requireSpaceEdit(
        this.access,
        client,
        userId,
        role,
        existing.space_id as string,
      );
      const token = newPublicToken();
      await client.query(
        `UPDATE forms SET public_token = $1, updated_at = now() WHERE id = $2`,
        [token, id],
      );
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "form.token_rotated",
        entity: "form",
        entityId: id,
      });
      return token;
    });
  }

  // --- Public (unauthenticated) ---------------------------------------------

  /**
   * The fill page's view of a form, by public token. Runs under the
   * app.form_token RLS context, so the SELECT can only ever return the one
   * matching row. Inactive or unknown tokens 404 identically. NEVER include
   * list/workspace ids in this shape.
   */
  async getPublicForm(token: string): Promise<PublicFormOut> {
    if (typeof token !== "string" || !token) {
      throw new NotFoundException("Form not found");
    }
    return this.db.withFormToken(token, async (client) => {
      const res = await client.query(
        `SELECT name, description, fields, active FROM forms
         WHERE public_token = $1`,
        [token],
      );
      const row = res.rows[0];
      if (!row || row.active !== true) {
        throw new NotFoundException("Form not found");
      }
      const fields = (row.fields as FormField[]) ?? [];
      return {
        name: row.name as string,
        description: (row.description as string) ?? "",
        fields: fields.map((f) => ({
          id: f.id,
          label: f.label,
          type: f.type,
          required: f.required === true,
          ...(f.options ? { options: f.options } : {}),
          ...(f.asTitle ? { asTitle: true } : {}),
          ...(f.visibleIf ? { visibleIf: f.visibleIf } : {}),
        })),
      };
    });
  }

  /**
   * Public submission: validate the values against the form's fields, then
   * create the task via the submit_form_task SECURITY DEFINER function — the
   * only write this unauthenticated context can perform.
   *
   * NOTE: no SSE `task.changed` hint is published here — the public path
   * deliberately never learns the form's workspace/list ids (that is the
   * whole point of the token-scoped RLS context), and the events bus is
   * keyed by workspace. Authed clients pick the new task up on their next
   * refetch/poll.
   */
  async submit(token: string, body: unknown): Promise<void> {
    if (typeof token !== "string" || !token) {
      throw new NotFoundException("Form not found");
    }
    // Light rate/abuse limit: refuse oversized payloads outright.
    if (JSON.stringify(body ?? {}).length > MAX_SUBMISSION_BYTES) {
      throw new PayloadTooLargeException("Submission too large");
    }
    const values = (body as { values?: unknown })?.values;
    if (typeof values !== "object" || values === null || Array.isArray(values)) {
      throw new BadRequestException("values must be an object");
    }

    await this.db.withFormToken(token, async (client) => {
      const res = await client.query(
        `SELECT name, fields, active FROM forms WHERE public_token = $1`,
        [token],
      );
      const row = res.rows[0];
      if (!row || row.active !== true) {
        throw new NotFoundException("Form not found");
      }
      const fields = (row.fields as FormField[]) ?? [];
      const { titleValue, lines } = validateSubmission(
        fields,
        values as Record<string, unknown>,
      );
      const title = titleValue ?? `${row.name as string} submission`;
      const description = lines.join("\n");
      await client.query(`SELECT submit_form_task($1, $2, $3)`, [
        token,
        title,
        description,
      ]);
    });
  }
}
