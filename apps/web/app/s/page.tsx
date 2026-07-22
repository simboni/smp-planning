"use client";

/**
 * Module 26 — the PUBLIC share page (`/s?t=…`).
 *
 * Lives outside the (app) group on purpose: no AppShell, no auth guard, no
 * localStorage. Anyone with the link can read the shared entity; every call
 * goes through the anonymous `publicShareApi`. A "View on StackUp" button
 * routes visitors to sign in / create an account.
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ApiError,
  publicShareApi,
  type SharedView,
  type TaskCard,
  type TaskDetail,
} from "@/lib/api";
import { Icons, StackMark } from "@/components/icons";
import { formatDueDate } from "@/lib/format";
import { Avatar } from "@/components/Avatar";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; view: SharedView }
  | { kind: "gone" }
  | { kind: "offline" };

function StatusDot({ color }: { color?: string }) {
  return (
    <span
      className="sv-dot"
      style={{ background: color || "var(--muted)" }}
      aria-hidden="true"
    />
  );
}

function Assignees({ users }: { users: TaskCard["assignees"] }) {
  if (!users || users.length === 0) return null;
  return (
    <span className="sv-avatars">
      {users.slice(0, 4).map((u) => (
        <Avatar
          key={u.id}
          name={u.fullName}
          id={u.id}
          avatarUrl={u.avatarUrl}
          className="avatar-sm"
          title={u.fullName}
        />
      ))}
    </span>
  );
}

function TaskRow({ t }: { t: TaskCard }) {
  return (
    <div className="sv-row">
      <StatusDot color={t.status?.color} />
      <span className="sv-row-name">{t.name}</span>
      {t.dueDate && <span className="sv-due">{formatDueDate(t.dueDate)}</span>}
      <Assignees users={t.assignees} />
    </div>
  );
}

function TaskBody({ task }: { task: TaskDetail }) {
  const groups = new Map<string, TaskCard[]>();
  for (const s of task.subtasks ?? []) {
    const k = s.status?.name ?? "Other";
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }
  return (
    <div className="sv-card">
      <div className="sv-task-head">
        <span className="sv-badge" style={{ background: task.status?.color }}>
          {task.status?.name}
        </span>
        {task.dueDate && (
          <span className="sv-due">Due {formatDueDate(task.dueDate)}</span>
        )}
        <Assignees users={task.assignees} />
      </div>
      {task.description && (
        <p className="sv-desc">{task.description}</p>
      )}
      {(task.checklists ?? []).map((c) => {
        const items = (c as { items?: { id: string; name: string; resolved: boolean }[] }).items ?? [];
        if (items.length === 0) return null;
        return (
          <div key={(c as { id: string }).id} className="sv-check">
            <div className="sv-sub-h">{(c as { name?: string }).name || "Checklist"}</div>
            {items.map((it) => (
              <div key={it.id} className={`sv-check-item${it.resolved ? " done" : ""}`}>
                <span className="sv-check-box">{it.resolved && Icons.check}</span>
                {it.name}
              </div>
            ))}
          </div>
        );
      })}
      {task.subtasks && task.subtasks.length > 0 && (
        <div className="sv-sub">
          <div className="sv-sub-h">Subtasks</div>
          {task.subtasks.map((s) => (
            <TaskRow key={s.id} t={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function ListBody({ list }: { list: NonNullable<SharedView["list"]> }) {
  const byStatus = new Map<string, { color?: string; tasks: TaskCard[] }>();
  for (const t of list.tasks) {
    const key = t.status?.name ?? "No status";
    if (!byStatus.has(key)) byStatus.set(key, { color: t.status?.color, tasks: [] });
    byStatus.get(key)!.tasks.push(t);
  }
  if (list.tasks.length === 0) {
    return <div className="sv-card muted">This list has no tasks yet.</div>;
  }
  return (
    <>
      {[...byStatus.entries()].map(([name, g]) => (
        <div key={name} className="sv-card">
          <div className="sv-group-h">
            <StatusDot color={g.color} />
            {name}
            <span className="sv-count">{g.tasks.length}</span>
          </div>
          {g.tasks.map((t) => (
            <TaskRow key={t.id} t={t} />
          ))}
        </div>
      ))}
    </>
  );
}

function DocBody({ doc }: { doc: NonNullable<SharedView["doc"]> }) {
  return (
    <div className="sv-card sv-doc">
      {(doc.pages ?? []).map((p) => (
        <section key={p.id} className="sv-page">
          <h2>{p.title}</h2>
          <div
            className="doc-content"
            dangerouslySetInnerHTML={{ __html: p.content || "" }}
          />
        </section>
      ))}
    </div>
  );
}

function DashboardBody({ dash }: { dash: NonNullable<SharedView["dashboard"]> }) {
  return (
    <div className="sv-grid">
      {dash.cards.map((c) => (
        <div key={c.id} className="sv-card">
          <div className="sv-group-h">{c.title}</div>
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            Open on StackUp to see this chart live.
          </div>
        </div>
      ))}
      {dash.cards.length === 0 && (
        <div className="sv-card muted">This dashboard has no cards yet.</div>
      )}
    </div>
  );
}

function OverviewBody({ ov }: { ov: NonNullable<SharedView["overview"]> }) {
  return (
    <div className="sv-card">
      {ov.lists.length === 0 ? (
        <div className="muted">Nothing shared inside yet.</div>
      ) : (
        ov.lists.map((l) => (
          <div key={l.id} className="sv-row">
            <span className="sv-row-ic">{Icons.tasks}</span>
            <span className="sv-row-name">{l.name}</span>
          </div>
        ))
      )}
    </div>
  );
}

function ShareView() {
  const search = useSearchParams();
  const token = search.get("t") ?? "";
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "gone" });
      return;
    }
    let stale = false;
    publicShareApi
      .resolve(token)
      .then((r) => !stale && setState({ kind: "ready", view: r.view }))
      .catch((err) => {
        if (stale) return;
        setState({ kind: err instanceof ApiError && err.status === 0 ? "offline" : "gone" });
      });
    return () => {
      stale = true;
    };
  }, [token]);

  const kind = state.kind === "ready" ? state.view.entityType : "";
  const typeLabel: Record<string, string> = {
    task: "Task",
    list: "List",
    doc: "Doc",
    dashboard: "Dashboard",
    space: "Space",
    folder: "Folder",
  };

  return (
    <div className="sv-wrap">
      <header className="sv-topbar">
        <span className="sv-brand">
          <span className="brand-mark">
            <StackMark />
          </span>
          <span className="brand-name">
            Stack<span className="up">Up</span>
          </span>
        </span>
        <Link href="/login" className="btn btn-primary btn-sm">
          View on StackUp
        </Link>
      </header>

      <main className="sv-main">
        {state.kind === "loading" && <div className="sv-center muted">Loading…</div>}

        {state.kind === "offline" && (
          <div className="sv-center">
            <h1>Can't reach StackUp</h1>
            <p className="muted">Check your connection and try again.</p>
          </div>
        )}

        {state.kind === "gone" && (
          <div className="sv-center">
            <div className="sv-gone-ic">{Icons.link}</div>
            <h1>This link isn't available</h1>
            <p className="muted">
              It may have been turned off by its owner, or the link is incorrect.
            </p>
            <Link href="/login" className="btn btn-primary" style={{ marginTop: 12 }}>
              Go to StackUp
            </Link>
          </div>
        )}

        {state.kind === "ready" && (
          <>
            <div className="sv-header">
              <div className="sv-eyebrow">
                {typeLabel[kind] ?? "Shared"} · {state.view.workspaceName}
              </div>
              <h1 className="sv-title">{state.view.title}</h1>
              <div className="sv-meta muted">
                {Icons.globe} Shared publicly · read-only
              </div>
            </div>

            {state.view.task && <TaskBody task={state.view.task} />}
            {state.view.list && <ListBody list={state.view.list} />}
            {state.view.doc && <DocBody doc={state.view.doc} />}
            {state.view.dashboard && <DashboardBody dash={state.view.dashboard} />}
            {state.view.overview && <OverviewBody ov={state.view.overview} />}

            <div className="sv-cta">
              <div>
                <div className="sv-cta-title">Work like this in StackUp</div>
                <div className="muted" style={{ fontSize: "0.88rem" }}>
                  Plan tasks, docs, goals and dashboards with your team.
                </div>
              </div>
              <Link href="/login" className="btn btn-primary">
                View on StackUp
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function PublicSharePage() {
  return (
    <Suspense fallback={<div className="sv-center muted">Loading…</div>}>
      <ShareView />
    </Suspense>
  );
}
