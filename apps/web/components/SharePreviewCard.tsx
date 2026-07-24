"use client";

/**
 * A link-preview-style card shown wherever something is about to be shared,
 * so the user sees exactly WHAT they're exposing (and to whom) before they
 * copy or hand out a public link. Mirrors the metadata card that recipients
 * would see for the link: a type badge, the item's title, a short summary,
 * and the access scope.
 */

import { Icons } from "@/components/icons";

export type ShareKind =
  | "space"
  | "folder"
  | "list"
  | "task"
  | "doc"
  | "dashboard"
  | "form";

const KIND_LABEL: Record<ShareKind, string> = {
  space: "Space",
  folder: "Folder",
  list: "List",
  task: "Task",
  doc: "Doc",
  dashboard: "Dashboard",
  form: "Form",
};

const KIND_ICON: Record<ShareKind, keyof typeof Icons> = {
  space: "spaces",
  folder: "folder",
  list: "list",
  task: "check",
  doc: "docs",
  dashboard: "dashboards",
  form: "docs",
};

export function SharePreviewCard({
  kind,
  name,
  summary,
  access = "Anyone with the link · read-only",
}: {
  kind: ShareKind;
  name: string;
  /** Short "what's inside" line, e.g. "12 tasks" or "8 questions". */
  summary?: string;
  /** What recipients can do — override for forms ("can submit a response"). */
  access?: string;
}) {
  return (
    <div className="spc" role="group" aria-label="Preview of what you're sharing">
      <div className="spc-strip" aria-hidden="true" />
      <div className="spc-main">
        <span className="spc-badge">
          {Icons[KIND_ICON[kind]]} {KIND_LABEL[kind]}
        </span>
        <div className="spc-name">{name || `Untitled ${KIND_LABEL[kind].toLowerCase()}`}</div>
        {summary && <div className="spc-summary">{summary}</div>}
        <div className="spc-access">
          {Icons.globe} {access}
        </div>
      </div>
    </div>
  );
}
