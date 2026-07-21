"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getUser,
  getWorkspace,
  homeApi,
  type HomeOverview,
  type PublicUser,
  type WorkspaceSummary,
} from "@/lib/api";
import { Icons, type IconKey } from "@/components/icons";
import { firstName } from "@/lib/format";

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

  useEffect(() => {
    setUser(getUser());
    setWorkspace(getWorkspace());
    homeApi
      .overview()
      .then(setOverview)
      .catch(() => setOverview(null));
  }, []);

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

      {/* quick jumps into the workspace */}
      <div className="section-title">
        <h2>Jump back in</h2>
        <span className="muted">Everything's ready to go</span>
      </div>
      <div className="module-grid">
        <Link href="/everything" className="module-tile module-tile-live">
          <span className="badge badge-soft" style={{ position: "absolute", top: 14, right: 14 }}>
            Ready
          </span>
          <span className="module-ic" style={{ background: "#7B68EE" }}>
            {Icons.spaces}
          </span>
          <h3>Spaces</h3>
          <p>Organize teams and projects — create your first space.</p>
        </Link>
        <Link href="/everything" className="module-tile module-tile-live">
          <span className="badge badge-soft" style={{ position: "absolute", top: 14, right: 14 }}>
            Ready
          </span>
          <span className="module-ic" style={{ background: "#5B5FEF" }}>
            {Icons.tasks}
          </span>
          <h3>Tasks</h3>
          <p>Lists, statuses & task detail — open a list to start.</p>
        </Link>
        <Link href="/docs" className="module-tile module-tile-live">
          <span className="badge badge-soft" style={{ position: "absolute", top: 14, right: 14 }}>
            Ready
          </span>
          <span className="module-ic" style={{ background: "#00B8D9" }}>
            {Icons.docs}
          </span>
          <h3>Docs</h3>
          <p>Wikis and collaborative docs — write your first page.</p>
        </Link>
        <Link href="/timesheet" className="module-tile module-tile-live">
          <span className="badge badge-soft" style={{ position: "absolute", top: 14, right: 14 }}>
            Ready
          </span>
          <span className="module-ic" style={{ background: "#E5578C" }}>
            {Icons.timer}
          </span>
          <h3>Time Tracking</h3>
          <p>Timers, timesheets & team workload — track your week.</p>
        </Link>
        <Link href="/goals" className="module-tile module-tile-live">
          <span className="badge badge-soft" style={{ position: "absolute", top: 14, right: 14 }}>
            Ready
          </span>
          <span className="module-ic" style={{ background: "#36B37E" }}>
            {Icons.goals}
          </span>
          <h3>Goals</h3>
          <p>OKRs, targets & portfolios — set a goal and watch it fill.</p>
        </Link>
        <Link href="/dashboards" className="module-tile module-tile-live">
          <span className="badge badge-soft" style={{ position: "absolute", top: 14, right: 14 }}>
            Ready
          </span>
          <span className="module-ic" style={{ background: "#FFAB00" }}>
            {Icons.dashboards}
          </span>
          <h3>Dashboards</h3>
          <p>Reporting at a glance — build a dashboard of live cards.</p>
        </Link>
      </div>
    </div>
  );
}
