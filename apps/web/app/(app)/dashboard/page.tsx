"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getUser,
  getWorkspace,
  homeApi,
  type HomeData,
  type HomeOverview,
  type PublicUser,
  type TaskCard,
  type WorkspaceSummary,
} from "@/lib/api";
import { Icons, type IconKey } from "@/components/icons";
import { firstName, formatDueDate, timeAgo } from "@/lib/format";

const CHECKLIST = [
  { title: "Create your workspace", sub: "You're in — nice work.", done: true },
  { title: "Invite your teammates", sub: "Work is better together.", done: false, href: "/members", cta: "Invite" },
  { title: "Set up your first Space", sub: "Organize teams, folders and lists.", done: false, href: "/everything", cta: "Open" },
  { title: "Create your first task", sub: "Open a list and add your first task.", done: false, href: "/everything", cta: "Open" },
];

/** The at-a-glance stat buttons, in display order. */
const STATS: {
  key: keyof HomeOverview;
  label: string;
  href: string;
  icon: IconKey;
  color: string;
}[] = [
  { key: "spaces", label: "Spaces", href: "/everything", icon: "spaces", color: "#7B68EE" },
  { key: "tasks", label: "Tasks", href: "/my-work", icon: "tasks", color: "#5B5FEF" },
  { key: "docs", label: "Docs", href: "/docs", icon: "docs", color: "#00B8D9" },
  { key: "goals", label: "Goals", href: "/goals", icon: "goals", color: "#36B37E" },
  { key: "dashboards", label: "Dashboards", href: "/dashboards", icon: "dashboards", color: "#FFAB00" },
  { key: "members", label: "Members", href: "/members", icon: "members", color: "#E5578C" },
];

export default function DashboardPage() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [overview, setOverview] = useState<HomeOverview | null>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  // Accordion: only one panel open at a time (opening one closes the other).
  const [openPanel, setOpenPanel] = useState<"attention" | "activity" | null>(
    "attention",
  );
  const toggle = (p: "attention" | "activity") =>
    setOpenPanel((cur) => (cur === p ? null : p));

  useEffect(() => {
    setUser(getUser());
    setWorkspace(getWorkspace());
    homeApi
      .overview()
      .then(setOverview)
      .catch(() => setOverview(null));
    homeApi
      .get()
      .then(setHome)
      .catch(() => setHome(null));
  }, []);

  // Tasks that need attention now: overdue first, then due today.
  const attention: TaskCard[] = home
    ? [...home.overdue, ...home.dueToday].slice(0, 6)
    : [];
  const taskHref = (t: { listId: string; id: string }) =>
    `/list?id=${t.listId}&task=${t.id}`;

  const doneCount = CHECKLIST.filter((c) => c.done).length;
  const progress = Math.round((doneCount / CHECKLIST.length) * 100);
  const name = user ? firstName(user.fullName) : "there";

  return (
    <div className="page">
      {/* greeting hero */}
      <div className="hero-card">
        <h1>Good to see you, {name} 👋</h1>
        <p>
          You're in <strong>{workspace?.name ?? "your workspace"}</strong>. This
          is your home base — plan work, track progress, and bring your team
          together as StackUp grows.
        </p>
        <div className="hero-actions">
          <Link href="/my-work" className="btn btn-primary">
            {Icons.checkCircle}
            My Work
          </Link>
          <Link href="/members" className="btn btn-soft">
            {Icons.invite}
            Invite teammates
          </Link>
          <button
            className="btn btn-ghost"
            onClick={() =>
              window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", metaKey: true }),
              )
            }
          >
            {Icons.search}
            Quick search
          </button>
        </div>
      </div>

      {/* top row: getting started + members */}
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h3>Getting started</h3>
            <span className="badge badge-soft">
              {doneCount}/{CHECKLIST.length} done
            </span>
          </div>
          <div className="progress" style={{ marginBottom: 12 }}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="checklist">
            {CHECKLIST.map((c) => (
              <div key={c.title} className={`check-item${c.done ? " done" : ""}`}>
                <span className="check-box">{c.done && Icons.check}</span>
                <span className="check-body">
                  <span className="check-title">{c.title}</span>
                  <span className="check-sub">{c.sub}</span>
                </span>
                {c.href && !c.done && (
                  <Link href={c.href} className="btn btn-soft btn-sm">
                    {c.cta}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Workspace at a glance</h3>
            <Link href="/everything" className="badge badge-soft" style={{ textDecoration: "none" }}>
              Browse
            </Link>
          </div>
          <div className="stat-grid">
            {STATS.map((s) => (
              <Link key={s.key} href={s.href} className="stat-tile">
                <span className="stat-tile-ic" style={{ background: s.color }}>
                  {Icons[s.icon]}
                </span>
                <span className="stat-tile-num">
                  {overview ? overview[s.key] : <span className="skel stat-tile-skel" />}
                </span>
                <span className="stat-tile-label">{s.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* second row: accordion — needs attention / recent activity */}
      <div className="accordion">
        <section className={`acc-item${openPanel === "attention" ? " open" : ""}`}>
          <button
            type="button"
            className="acc-head"
            aria-expanded={openPanel === "attention"}
            onClick={() => toggle("attention")}
          >
            <span className="acc-chevron">{Icons.chevronDown}</span>
            <span className="acc-title">Needs your attention</span>
            {home && attention.length > 0 && (
              <span className="acc-count">{attention.length}</span>
            )}
            <Link
              href="/my-work"
              className="badge badge-soft acc-link"
              style={{ textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
            >
              My Work
            </Link>
          </button>
          <div className="acc-body">
            <div className="acc-body-inner">
              {home === null ? (
                <>
                  <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
                  <span className="skel" style={{ width: "100%", height: 44 }} />
                </>
              ) : attention.length === 0 ? (
                <div className="home-empty">
                  <span className="home-empty-ic">{Icons.checkCircle}</span>
                  <div>
                    <div className="home-empty-title">You're all caught up 🎉</div>
                    <div className="muted" style={{ fontSize: "0.86rem" }}>
                      Nothing overdue or due today. Nice work.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="home-list">
                  {attention.map((t) => {
                    const overdue = home.overdue.some((o) => o.id === t.id);
                    return (
                      <Link key={t.id} href={taskHref(t)} className="home-row">
                        <span
                          className="home-row-dot"
                          style={{ background: t.status.color || "var(--muted)" }}
                        />
                        <span className="home-row-main">
                          <span className="home-row-name">{t.name}</span>
                          <span className="home-row-sub">{t.status.name}</span>
                        </span>
                        <span className={`home-due${overdue ? " overdue" : ""}`}>
                          {formatDueDate(t.dueDate)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className={`acc-item${openPanel === "activity" ? " open" : ""}`}>
          <button
            type="button"
            className="acc-head"
            aria-expanded={openPanel === "activity"}
            onClick={() => toggle("activity")}
          >
            <span className="acc-chevron">{Icons.chevronDown}</span>
            <span className="acc-title">Recent activity</span>
            {home && home.recent.length > 0 && (
              <span className="acc-count">{home.recent.length}</span>
            )}
            <Link
              href="/my-work"
              className="badge badge-soft acc-link"
              style={{ textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
            >
              View all
            </Link>
          </button>
          <div className="acc-body">
            <div className="acc-body-inner">
              {home === null ? (
                <>
                  <span className="skel" style={{ width: "100%", height: 40, marginBottom: 8 }} />
                  <span className="skel" style={{ width: "100%", height: 40 }} />
                </>
              ) : home.recent.length === 0 ? (
                <div className="home-empty">
                  <span className="home-empty-ic">{Icons.clock}</span>
                  <div>
                    <div className="home-empty-title">No activity yet</div>
                    <div className="muted" style={{ fontSize: "0.86rem" }}>
                      Create or update a task and it'll show up here.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="home-list">
                  {home.recent.slice(0, 6).map((r, i) => (
                    <Link
                      key={`${r.taskId}-${i}`}
                      href={`/list?id=${r.listId}&task=${r.taskId}`}
                      className="home-row"
                    >
                      <span className="home-row-ic">{Icons.checkCircle}</span>
                      <span className="home-row-main">
                        <span className="home-row-name">{r.taskName}</span>
                        <span className="home-row-sub">{humanizeKind(r.kind)}</span>
                      </span>
                      <span className="home-due">{timeAgo(r.createdAt)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Turn an activity kind ("status_changed") into a readable phrase. */
function humanizeKind(kind: string): string {
  const map: Record<string, string> = {
    created: "Task created",
    updated: "Task updated",
    status_changed: "Status changed",
    assigned: "Assignment changed",
    commented: "New comment",
    completed: "Marked complete",
    due_changed: "Due date changed",
  };
  return map[kind] ?? kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
