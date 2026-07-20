import { BadRequestException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * Shared building blocks for Module 11 Forms: the field schema stored in
 * forms.fields (jsonb), its validator, and validation of a public submission
 * against that schema.
 */

export const FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "number",
  "select",
  "date",
  "checkbox",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * Conditional visibility (M21): the field is shown only when the referenced
 * (earlier) field's answer equals `equals`. For a select/checkbox controller
 * this drives branching forms.
 */
export interface FieldCondition {
  fieldId: string;
  equals: string;
}

export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  asTitle?: boolean;
  visibleIf?: FieldCondition;
}

const MAX_FIELDS = 50;
const MAX_OPTIONS = 50;

/** 32-char url-safe public token (24 random bytes, base64url). */
export function newPublicToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Validate + normalize a client-supplied fields array. Field ids are SERVER
 * generated: a well-formed existing id survives an edit round-trip, anything
 * else gets a fresh uuid. Labels are required, selects need options, and at
 * most one field may be flagged asTitle.
 */
export function validateFields(input: unknown): FormField[] {
  if (!Array.isArray(input)) {
    throw new BadRequestException("fields must be an array");
  }
  if (input.length > MAX_FIELDS) {
    throw new BadRequestException(`fields is limited to ${MAX_FIELDS} entries`);
  }
  let titleCount = 0;
  const fields: FormField[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new BadRequestException("each field must be an object");
    }
    const f = raw as Record<string, unknown>;
    if (typeof f.label !== "string" || !f.label.trim()) {
      throw new BadRequestException("every field needs a label");
    }
    if (!FIELD_TYPES.includes(f.type as FieldType)) {
      throw new BadRequestException(
        `field type must be one of ${FIELD_TYPES.join(", ")}`,
      );
    }
    const type = f.type as FieldType;
    const out: FormField = {
      id:
        typeof f.id === "string" && f.id.trim() !== ""
          ? f.id
          : randomUUID(),
      label: f.label.trim(),
      type,
      required: f.required === true,
    };
    if (type === "select") {
      if (
        !Array.isArray(f.options) ||
        f.options.length === 0 ||
        f.options.some((o) => typeof o !== "string" || !o.trim())
      ) {
        throw new BadRequestException(
          "select fields need a non-empty options array of strings",
        );
      }
      if (f.options.length > MAX_OPTIONS) {
        throw new BadRequestException(
          `select options are limited to ${MAX_OPTIONS} entries`,
        );
      }
      out.options = (f.options as string[]).map((o) => o.trim());
    }
    if (f.asTitle === true) {
      out.asTitle = true;
      titleCount += 1;
    }
    if (f.visibleIf !== undefined && f.visibleIf !== null) {
      const c = f.visibleIf as Record<string, unknown>;
      if (
        typeof c.fieldId !== "string" ||
        typeof c.equals !== "string" ||
        !c.fieldId.trim()
      ) {
        throw new BadRequestException(
          "visibleIf must be { fieldId, equals } strings",
        );
      }
      // The controller must be an EARLIER field — this both prevents cycles
      // and guarantees its answer is known before this field is evaluated.
      if (!fields.some((prev) => prev.id === c.fieldId)) {
        throw new BadRequestException(
          "visibleIf.fieldId must reference an earlier field",
        );
      }
      out.visibleIf = { fieldId: c.fieldId, equals: c.equals };
    }
    fields.push(out);
  }
  if (titleCount > 1) {
    throw new BadRequestException("at most one field may be marked asTitle");
  }
  return fields;
}

/** The submitted answer for a field as a plain comparison string. */
function answerString(value: unknown): string {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === undefined || value === null) return "";
  return String(value);
}

/**
 * A field is visible iff it has no condition, or the controlling field's
 * submitted answer equals the condition's value. Hidden fields are neither
 * required nor recorded.
 */
export function fieldIsVisible(
  field: FormField,
  values: Record<string, unknown>,
): boolean {
  if (!field.visibleIf) return true;
  return answerString(values[field.visibleIf.fieldId]) === field.visibleIf.equals;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

/** Is the submitted value "missing" for required/description purposes? */
function isMissing(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/**
 * Validate one public submission against the form's fields (required + type
 * checks) and render each provided value to its display string. Throws 400
 * with the offending label on any violation.
 */
export function validateSubmission(
  fields: FormField[],
  values: Record<string, unknown>,
): { titleValue: string | null; lines: string[] } {
  let titleValue: string | null = null;
  const lines: string[] = [];
  for (const field of fields) {
    // M21: a field hidden by its condition is skipped entirely — not required,
    // and any stray submitted value for it is ignored.
    if (!fieldIsVisible(field, values)) continue;
    const value = values[field.id];
    if (isMissing(value)) {
      if (field.required) {
        throw new BadRequestException(`"${field.label}" is required`);
      }
      continue;
    }
    let display: string;
    switch (field.type) {
      case "text":
      case "textarea":
        if (typeof value !== "string") {
          throw new BadRequestException(`"${field.label}" must be text`);
        }
        display = value;
        break;
      case "email":
        if (typeof value !== "string" || !EMAIL_RE.test(value.trim())) {
          throw new BadRequestException(
            `"${field.label}" must be a valid email address`,
          );
        }
        display = value.trim();
        break;
      case "number": {
        const ok =
          (typeof value === "number" && Number.isFinite(value)) ||
          (typeof value === "string" && NUMBER_RE.test(value.trim()));
        if (!ok) {
          throw new BadRequestException(`"${field.label}" must be a number`);
        }
        display = String(value).trim();
        break;
      }
      case "date":
        if (
          typeof value !== "string" ||
          !DATE_RE.test(value) ||
          Number.isNaN(Date.parse(value))
        ) {
          throw new BadRequestException(
            `"${field.label}" must be a date (YYYY-MM-DD)`,
          );
        }
        display = value;
        break;
      case "select":
        if (
          typeof value !== "string" ||
          !(field.options ?? []).includes(value)
        ) {
          throw new BadRequestException(
            `"${field.label}" must be one of its options`,
          );
        }
        display = value;
        break;
      case "checkbox":
        if (typeof value !== "boolean") {
          throw new BadRequestException(
            `"${field.label}" must be true or false`,
          );
        }
        // A required checkbox means "must be checked" (consent-style).
        if (field.required && value !== true) {
          throw new BadRequestException(`"${field.label}" is required`);
        }
        display = value ? "Yes" : "No";
        break;
    }
    if (field.asTitle && titleValue === null && display.trim() !== "") {
      titleValue = display.trim();
    }
    lines.push(`${field.label}: ${display}`);
  }
  return { titleValue, lines };
}
