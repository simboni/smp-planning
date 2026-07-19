"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getUser,
  getWorkspace,
  workspacesApi,
  type Member,
  type PublicUser,
  type WorkspaceSummary,
} from "@/lib/api";
import { Icons, type IconKey } from "@/components/icons";
import { colorFor, firstName, initials } from "@/lib/format";

interface ModuleTile {
  label: string;
  desc: string;
  icon: IconKey;
  color: string;
}

const MODULES: ModuleTile[] = [
  { label: "Goals", desc: "Targets that roll up", icon: "goals", color: "#36B37E" },
  { label: "Dashboards", desc: "Reporting at a glance", icon: "dashboards", color: "#FFAB00" },
];

const CHECKLIST = [
  { title: "Create your workspace", sub: "You're in — nice work.", done: true },
  { title: "Invite your teammates", sub: "Work is better together.", done: false, href: "/members", cta: "Invite" },
  { title: "Set up your first Space", sub: "Organize teams, folders and lists.", done: false, href: "/everything", cta: "Open" },
  { title: "Create your first task", sub: "Open a list and add your first task.", done: false, href: "/everything", cta: "Open" },
];

export default function DashboardPage() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);

  useEffect(() => {
    setUser(getUser());
    setWorkspace(getWorkspace());
    workspacesApi
      .members()
      .then((r) => setMembers(r.members))
      .catch(() => setMembers([]));
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
          <Link href="/members" className="btn btn-primary">
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
            <h3>Members</h3>
            <Link href="/members" className="badge badge-soft" style={{ textDecoration: "none" }}>
              Manage
            </Link>
          </div>
          {members === null ? (
            <>
              <span className="skel" style={{ width: 80, height: 32, marginBottom: 14 }} />
              <span className="skel" style={{ width: "100%", height: 40, marginBottom: 8 }} />
              <span className="skel" style={{ width: "100%", height: 40 }} />
            </>
          ) : (
            <>
              <div className="stat-big">{members.length}</div>
              <div className="muted" style={{ fontSize: "0.85rem", marginBottom: 12 }}>
                {members.length === 1 ? "person" : "people"} in this workspace
              </div>
              {members.slice(0, 3).map((m) => (
                <div className="member-mini" key={m.id}>
                  <span className="avatar avatar-sm" style={{ background: colorFor(m.id) }}>
                    {initials(m.fullName || m.email)}
                  </span>
                  <span className="member-mini-body">
                    <span className="member-mini-name">{m.fullName || m.email}</span>
                    <span className="member-mini-email">{m.email}</span>
                  </span>
                  <span className={`badge role-${m.role}`}>{m.role}</span>
                </div>
              ))}
              {members.length === 0 && (
                <div className="muted" style={{ fontSize: "0.88rem" }}>
                  Just you so far. Invite your team to get going.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* module roadmap */}
      <div className="section-title">
        <h2>Your workspace, leveling up</h2>
        <span className="muted">More modules are on the way</span>
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
        {MODULES.map((m) => (
          <div className="module-tile" key={m.label}>
            <span className="badge badge-soon">Coming soon</span>
            <span className="module-ic" style={{ background: m.color }}>
              {Icons[m.icon]}
            </span>
            <h3>{m.label}</h3>
            <p>{m.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
