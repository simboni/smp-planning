import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Role } from "@stackup/shared";
import { AccessService } from "../access/access.service";
import { DbService } from "../db/db.service";
import {
  requireName,
  requireSpaceEdit,
  requireSpaceVisible,
  validColor,
} from "./tasks.support";

/**
 * Module 4: Custom Fields. Typed field DEFINITIONS live on a Space
 * (custom_fields, jsonb config); VALUES live per task+field
 * (custom_field_values, jsonb value; unset = no row). This service owns both
 * sides: definition CRUD and per-task value set/unset, normalizing and
 * validating every config/value shape per field type in the API (the DB
 * stores opaque jsonb).
 */

export const FIELD_TYPES = [
  "text",
  "number",
  "money",
  "date",
  "dropdown",
  "labels",
  "checkbox",
  "url",
  "email",
  "phone",
  "rating",
  "progress",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
  config: Record<string, unknown>;
  position: number;
}

interface FieldOption {
  id: string;
  name: string;
  color: string;
}

function toField(r: Record<string, unknown>): FieldDef {
  return {
    id: r.id as string,
    name: r.name as string,
    type: r.type as FieldType,
    config: r.config as Record<string, unknown>,
    position: r.position as number,
  };
}

export function validFieldType(type: unknown): FieldType {
  if (!FIELD_TYPES.includes(type as FieldType)) {
    throw new BadRequestException(
      `type must be one of ${FIELD_TYPES.join(", ")}`,
    );
  }
  return type as FieldType;
}

/**
 * Normalize a field's config for its type. Dropdown/labels options get
 * server-generated ids (kept when the client passes existing ones back, so
 * renames don't orphan stored values); other types keep only the keys the
 * type understands.
 */
export function normalizeConfig(
  type: FieldType,
  config: unknown,
): Record<string, unknown> {
  if (
    config !== undefined &&
    (typeof config !== "object" || config === null || Array.isArray(config))
  ) {
    throw new BadRequestException("config must be an object");
  }
  const c = (config ?? {}) as Record<string, unknown>;
  switch (type) {
    case "dropdown":
    case "labels": {
      const raw = c.options ?? [];
      if (!Array.isArray(raw)) {
        throw new BadRequestException("config.options must be an array");
      }
      const options: FieldOption[] = raw.map((o) => {
        if (typeof o !== "object" || o === null || Array.isArray(o)) {
          throw new BadRequestException("each option must be an object");
        }
        const opt = o as Record<string, unknown>;
        const name = requireName(opt.name, "option name");
        const id =
          typeof opt.id === "string" && opt.id ? opt.id : randomUUID();
        const color =
          opt.color === undefined || opt.color === null
            ? "#8A8F98"
            : validColor(opt.color, "option color");
        return { id, name, color };
      });
      if (new Set(options.map((o) => o.id)).size !== options.length) {
        throw new BadRequestException("option ids must be unique");
      }
      return { options };
    }
    case "money": {
      const currency =
        c.currency === undefined || c.currency === null ? "USD" : c.currency;
      if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
        throw new BadRequestException(
          "config.currency must be a 3-letter currency code",
        );
      }
      return { currency: currency.toUpperCase() };
    }
    case "rating": {
      const max = c.max === undefined || c.max === null ? 5 : c.max;
      if (
        typeof max !== "number" ||
        !Number.isInteger(max) ||
        max < 1 ||
        max > 10
      ) {
        throw new BadRequestException(
          "config.max must be an integer between 1 and 10",
        );
      }
      return { max };
    }
    default:
      return {};
  }
}

function configOptionIds(config: Record<string, unknown>): Set<string> {
  const options = Array.isArray(config.options)
    ? (config.options as FieldOption[])
    : [];
  return new Set(options.map((o) => o.id));
}

/** Validate + normalize a value payload against the field's type & config. */
export function normalizeValue(
  type: FieldType,
  config: Record<string, unknown>,
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException(
      "value must be an object matching the field type, or null to unset",
    );
  }
  const v = value as Record<string, unknown>;
  switch (type) {
    case "text":
    case "url":
    case "email":
    case "phone": {
      if (typeof v.text !== "string") {
        throw new BadRequestException("value.text must be a string");
      }
      return { text: v.text };
    }
    case "number":
    case "money": {
      if (typeof v.number !== "number" || !Number.isFinite(v.number)) {
        throw new BadRequestException("value.number must be a number");
      }
      return { number: v.number };
    }
    case "rating": {
      const max = typeof config.max === "number" ? config.max : 5;
      if (
        typeof v.number !== "number" ||
        !Number.isInteger(v.number) ||
        v.number < 0 ||
        v.number > max
      ) {
        throw new BadRequestException(
          `value.number must be an integer between 0 and ${max}`,
        );
      }
      return { number: v.number };
    }
    case "progress": {
      if (
        typeof v.number !== "number" ||
        !Number.isFinite(v.number) ||
        v.number < 0 ||
        v.number > 100
      ) {
        throw new BadRequestException(
          "value.number must be a number between 0 and 100",
        );
      }
      return { number: v.number };
    }
    case "date": {
      if (typeof v.date !== "string" || Number.isNaN(Date.parse(v.date))) {
        throw new BadRequestException("value.date must be an ISO date string");
      }
      return { date: new Date(v.date).toISOString() };
    }
    case "checkbox": {
      if (typeof v.checked !== "boolean") {
        throw new BadRequestException("value.checked must be a boolean");
      }
      return { checked: v.checked };
    }
    case "dropdown": {
      const ids = configOptionIds(config);
      if (typeof v.optionId !== "string" || !ids.has(v.optionId)) {
        throw new BadRequestException(
          "value.optionId must be one of the field's options",
        );
      }
      return { optionId: v.optionId };
    }
    case "labels": {
      if (
        !Array.isArray(v.optionIds) ||
        v.optionIds.some((x) => typeof x !== "string")
      ) {
        throw new BadRequestException(
          "value.optionIds must be an array of option ids",
        );
      }
      const ids = configOptionIds(config);
      const out: string[] = [];
      for (const id of v.optionIds as string[]) {
        if (!ids.has(id)) {
          throw new BadRequestException(
            "value.optionIds must all be options on this field",
          );
        }
        if (!out.includes(id)) out.push(id);
      }
      return { optionIds: out };
    }
  }
}

@Injectable()
export class FieldsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  private async fieldRow(
    client: PoolClient,
    id: string,
  ): Promise<Record<string, unknown>> {
    const res = await client.query(
      `SELECT id, space_id, name, type, config, position
       FROM custom_fields WHERE id = $1`,
      [id],
    );
    if (!res.rows[0]) throw new NotFoundException("Field not found");
    return res.rows[0];
  }

  async listFields(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
  ): Promise<FieldDef[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceVisible(this.access, client, userId, role, spaceId);
      const res = await client.query(
        `SELECT id, name, type, config, position FROM custom_fields
         WHERE space_id = $1 ORDER BY position, created_at`,
        [spaceId],
      );
      return res.rows.map(toField);
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    role: Role,
    spaceId: string,
    body: { name?: string; type?: string; config?: unknown },
  ): Promise<FieldDef> {
    const name = requireName(body?.name);
    const type = validFieldType(body?.type);
    const config = normalizeConfig(type, body?.config);
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      await requireSpaceEdit(this.access, client, userId, role, spaceId);
      const pos = await client.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS n
         FROM custom_fields WHERE space_id = $1`,
        [spaceId],
      );
      try {
        const res = await client.query(
          `INSERT INTO custom_fields (workspace_id, space_id, name, type, config, position)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, name, type, config, position`,
          [
            workspaceId,
            spaceId,
            name,
            type,
            JSON.stringify(config),
            pos.rows[0].n as number,
          ],
        );
        return toField(res.rows[0]);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new ConflictException(
            "A field with this name already exists in this space",
          );
        }
        throw err;
      }
    });
  }

  async update(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
    body: { name?: string; config?: unknown; position?: number },
  ): Promise<FieldDef> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const field = await this.fieldRow(client, id);
      await requireSpaceEdit(
        this.access,
        client,
        userId,
        role,
        field.space_id as string,
      );
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (body?.name !== undefined) {
        sets.push(`name = $${i++}`);
        params.push(requireName(body.name));
      }
      if (body?.config !== undefined) {
        const config = normalizeConfig(field.type as FieldType, body.config);
        sets.push(`config = $${i++}`);
        params.push(JSON.stringify(config));
      }
      if (body?.position !== undefined) {
        if (
          typeof body.position !== "number" ||
          !Number.isInteger(body.position) ||
          body.position < 0
        ) {
          throw new BadRequestException(
            "position must be a non-negative integer",
          );
        }
        sets.push(`position = $${i++}`);
        params.push(body.position);
      }
      if (sets.length === 0) return toField(field);
      params.push(id);
      try {
        const res = await client.query(
          `UPDATE custom_fields SET ${sets.join(", ")} WHERE id = $${i}
           RETURNING id, name, type, config, position`,
          params,
        );
        return toField(res.rows[0]);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new ConflictException(
            "A field with this name already exists in this space",
          );
        }
        throw err;
      }
    });
  }

  async remove(
    workspaceId: string,
    userId: string,
    role: Role,
    id: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const field = await this.fieldRow(client, id);
      await requireSpaceEdit(
        this.access,
        client,
        userId,
        role,
        field.space_id as string,
      );
      // custom_field_values cascade on the field FK.
      await client.query(`DELETE FROM custom_fields WHERE id = $1`, [id]);
    });
  }

  /**
   * Set (upsert) or unset (value = null) a field value on a task, validating
   * the payload against the field's definition.
   */
  async setValue(
    workspaceId: string,
    userId: string,
    role: Role,
    taskId: string,
    fieldId: string,
    value: unknown,
  ): Promise<{ fieldId: string; value: Record<string, unknown> | null }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const task = await client.query(
        `SELECT space_id FROM tasks WHERE id = $1`,
        [taskId],
      );
      if (!task.rows[0]) throw new NotFoundException("Task not found");
      const spaceId = task.rows[0].space_id as string;
      await requireSpaceEdit(this.access, client, userId, role, spaceId);

      const field = await this.fieldRow(client, fieldId);
      if ((field.space_id as string) !== spaceId) {
        throw new BadRequestException(
          "field does not belong to this task's space",
        );
      }

      if (value === null || value === undefined) {
        await client.query(
          `DELETE FROM custom_field_values WHERE task_id = $1 AND field_id = $2`,
          [taskId, fieldId],
        );
        return { fieldId, value: null };
      }

      const normalized = normalizeValue(
        field.type as FieldType,
        field.config as Record<string, unknown>,
        value,
      );
      await client.query(
        `INSERT INTO custom_field_values (workspace_id, task_id, field_id, value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (task_id, field_id)
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [workspaceId, taskId, fieldId, JSON.stringify(normalized)],
      );
      return { fieldId, value: normalized };
    });
  }
}
