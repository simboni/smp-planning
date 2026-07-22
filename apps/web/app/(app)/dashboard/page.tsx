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

/**
 * Onboarding checklist. `done` is derived from real workspace counts (see
 * buildChecklist), so each step ticks off as it's actually accomplished and
 * the whole card disappears once everything's complete.
 */
type ChecklistItem = {
  title: string;
  sub: string;
  done: boolean;
  href?: string;
  cta?: string;
};

function buildChecklist(ov: HomeOverview | null): ChecklistItem[] {
  return [
    { title: "Create your workspace", sub: "You're in — nice work.", done: true },
    {
      title: "Invite your teammates",
      sub: "Work is better together.",
      done: (ov?.members ?? 0) > 1,
      href: "/members",
      cta: "Invite",
    },
    {
      title: "Set up your first Space",
      sub: "Organize teams, folders and lists.",
      done: (ov?.spaces ?? 0) > 0,
      href: "/everything",
      cta: "Open",
    },
    {
      title: "Create your first task",
      sub: "Open a list and add your first task.",
      done: (ov?.tasks ?? 0) > 0,
      href: "/everything",
      cta: "Open",
    },
  ];
}

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

/* ------------------------------------------------------------------ *
 * Customizable Home cards. Each card is a self-contained widget the user
 * can add, remove and reorder. The chosen layout persists per user in
 * localStorage, so everyone shapes their own home base.
 * ------------------------------------------------------------------ */
type CardCtx = { home: HomeData | null; overview: HomeOverview | null };

type CardDef = {
  id: string;
  title: string;
  icon: IconKey;
  /** One-line description shown in the "Add card" catalog. */
  desc: string;
  link?: { href: string; label: string };
  body: (ctx: CardCtx) => React.ReactNode;
};

const taskHref = (t: { listId: string; id: string }) =>
  `/list?id=${t.listId}&task=${t.id}`;

const CARD_CATALOG: CardDef[] = [
  {
    id: "stats",
    title: "Workspace at a glance",
    icon: "dashboards",
    desc: "Counts of spaces, tasks, docs, goals and more.",
    link: { href: "/everything", label: "Browse" },
    body: ({ overview }) => (
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
    ),
  },
  {
    id: "attention",
    title: "Needs your attention",
    icon: "flag",
    desc: "Tasks that are overdue or due today.",
    link: { href: "/my-work", label: "My Work" },
    body: ({ home }) => {
      const attention: TaskCard[] = home
        ? [...home.overdue, ...home.dueToday].slice(0, 6)
        : [];
      if (home === null) {
        return (
          <>
            <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
            <span className="skel" style={{ width: "100%", height: 44 }} />
          </>
        );
      }
      if (attention.length === 0) {
        return (
          <div className="home-empty">
            <span className="home-empty-ic">{Icons.checkCircle}</span>
            <div>
              <div className="home-empty-title">You're all caught up 🎉</div>
              <div className="muted" style={{ fontSize: "0.86rem" }}>
                Nothing overdue or due today. Nice work.
              </div>
            </div>
          </div>
        );
      }
      return (
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
      );
    },
  },
  {
    id: "activity",
    title: "Recent activity",
    icon: "clock",
    desc: "The latest changes across your tasks.",
    link: { href: "/my-work", label: "View all" },
    body: ({ home }) => {
      if (home === null) {
        return (
          <>
            <span className="skel" style={{ width: "100%", height: 40, marginBottom: 8 }} />
            <span className="skel" style={{ width: "100%", height: 40 }} />
          </>
        );
      }
      if (home.recent.length === 0) {
        return (
          <div className="home-empty">
            <span className="home-empty-ic">{Icons.clock}</span>
            <div>
              <div className="home-empty-title">No activity yet</div>
              <div className="muted" style={{ fontSize: "0.86rem" }}>
                Create or update a task and it'll show up here.
              </div>
            </div>
          </div>
        );
      }
      return (
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
      );
    },
  },
  {
    id: "quicklinks",
    title: "Quick links",
    icon: "bolt",
    desc: "One-tap shortcuts to the places you work most.",
    body: () => (
      <div className="quicklinks">
        {QUICK_LINKS.map((q) => (
          <Link key={q.href} href={q.href} className="quicklink">
            <span className="quicklink-ic">{Icons[q.icon]}</span>
            {q.label}
          </Link>
        ))}
      </div>
    ),
  },
  {
    id: "notepad",
    title: "Notepad",
    icon: "docs",
    desc: "A private scratchpad that stays on this device.",
    body: () => <NotepadCard />,
  },
];

const QUICK_LINKS: { href: string; label: string; icon: IconKey }[] = [
  { href: "/my-work", label: "My Work", icon: "checkCircle" },
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/docs", label: "Docs", icon: "docs" },
  { href: "/goals", label: "Goals", icon: "goals" },
  { href: "/dashboards", label: "Dashboards", icon: "dashboards" },
  { href: "/timesheet", label: "Timesheet", icon: "clock" },
];

const DEFAULT_LAYOUT = ["stats", "attention", "activity"];

function layoutKey(userId: string | undefined): string {
  return `stackup.home.layout.${userId ?? "anon"}`;
}

function loadLayout(userId: string | undefined): string[] {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(layoutKey(userId));
    if (!raw) return DEFAULT_LAYOUT;
    const ids = (JSON.parse(raw) as string[]).filter((id) =>
      CARD_CATALOG.some((c) => c.id === id),
    );
    return ids.length ? ids : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export default function DashboardPage() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [overview, setOverview] = useState<HomeOverview | null>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  const [layout, setLayout] = useState<string[]>(DEFAULT_LAYOUT);
  const [customizing, setCustomizing] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const u = getUser();
    setUser(u);
    setWorkspace(getWorkspace());
    setLayout(loadLayout(u?.id));
    homeApi.overview().then(setOverview).catch(() => setOverview(null));
    homeApi.get().then(setHome).catch(() => setHome(null));
  }, []);

  // Persist the layout whenever the user reshapes it.
  const persist = (next: string[]) => {
    setLayout(next);
    try {
      window.localStorage.setItem(layoutKey(user?.id), JSON.stringify(next));
    } catch {
      /* storage disabled — layout stays for this session only */
    }
  };

  const addCard = (id: string) => {
    if (!layout.includes(id)) persist([...layout, id]);
    setAdding(false);
  };
  const removeCard = (id: string) => persist(layout.filter((c) => c !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = layout.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= layout.length) return;
    const next = [...layout];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };

  const ctx: CardCtx = { home, overview };
  const cards = layout
    .map((id) => CARD_CATALOG.find((c) => c.id === id))
    .filter((c): c is CardDef => Boolean(c));
  const available = CARD_CATALOG.filter((c) => !layout.includes(c.id));

  const checklist = buildChecklist(overview);
  const doneCount = checklist.filter((c) => c.done).length;
  const progress = Math.round((doneCount / checklist.length) * 100);
  const allDone = overview !== null && doneCount === checklist.length;
  const name = user ? firstName(user.fullName) : "there";

  return (
    <div className="page">
      {overview !== null && (
        <GuideBanner doneCount={doneCount} total={checklist.length} allDone={allDone} />
      )}

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
          <Link href="/guide" className="btn btn-ghost">
            {Icons.book}
            Guide
          </Link>
        </div>
      </div>

      {/* onboarding checklist — auto-retires once every step is done */}
      {!allDone && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <h3>Getting started</h3>
            <span className="badge badge-soft">
              {doneCount}/{checklist.length} done
            </span>
          </div>
          <div className="progress" style={{ marginBottom: 12 }}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="checklist">
            {checklist.map((c) => (
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
      )}

      {/* customize toolbar */}
      <div className="home-toolbar">
        <h2 className="home-toolbar-title">Your dashboard</h2>
        <div className="home-toolbar-actions">
          {customizing && available.length > 0 && (
            <div className="home-add">
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={() => setAdding((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={adding}
              >
                {Icons.plus} Add card
              </button>
              {adding && (
                <div className="menu home-add-menu" role="menu">
                  <div className="menu-label">Add a card</div>
                  {available.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="menuitem"
                      className="home-add-opt"
                      onClick={() => addCard(c.id)}
                    >
                      <span className="home-add-ic">{Icons[c.icon]}</span>
                      <span className="home-add-body">
                        <span className="home-add-name">{c.title}</span>
                        <span className="home-add-desc">{c.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className={`btn btn-sm ${customizing ? "btn-primary" : "btn-ghost"}`}
            onClick={() => {
              setCustomizing((v) => !v);
              setAdding(false);
            }}
          >
            {customizing ? <>{Icons.check} Done</> : <>{Icons.settings} Customize</>}
          </button>
        </div>
      </div>

      {/* the customizable card board */}
      {cards.length === 0 ? (
        <div className="card">
          <div className="home-empty">
            <span className="home-empty-ic">{Icons.plus}</span>
            <div>
              <div className="home-empty-title">Your dashboard is empty</div>
              <div className="muted" style={{ fontSize: "0.86rem" }}>
                Hit <strong>Customize → Add card</strong> to build your home base.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="home-board">
          {cards.map((c, i) => (
            <section key={c.id} className={`card home-card${customizing ? " editing" : ""}`}>
              <div className="card-head">
                <h3>
                  <span className="home-card-ic">{Icons[c.icon]}</span> {c.title}
                </h3>
                {customizing ? (
                  <div className="home-card-tools">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => move(c.id, -1)}
                    >
                      {Icons.arrowUp}
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Move down"
                      disabled={i === cards.length - 1}
                      onClick={() => move(c.id, 1)}
                    >
                      {Icons.arrowDown}
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      aria-label={`Remove ${c.title}`}
                      onClick={() => removeCard(c.id)}
                    >
                      {Icons.close}
                    </button>
                  </div>
                ) : (
                  c.link && (
                    <Link
                      href={c.link.href}
                      className="badge badge-soft"
                      style={{ textDecoration: "none" }}
                    >
                      {c.link.label}
                    </Link>
                  )
                )}
              </div>
              <div className="home-card-body">{c.body(ctx)}</div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Points new and struggling users to the Knowledge Base. A first-time visitor
 * gets a welcome nudge; if they're still stuck after a few days (most of the
 * getting-started checklist undone), the nudge changes to a "need a hand?"
 * message and reappears even if previously dismissed.
 */
function GuideBanner({
  doneCount,
  total,
  allDone,
}: {
  doneCount: number;
  total: number;
  allDone: boolean;
}) {
  const SEEN_KEY = "stackup.firstSeen";
  const DISMISS_KEY = "stackup.guide.dismissed";
  const [show, setShow] = useState(false);
  const [struggling, setStruggling] = useState(false);

  useEffect(() => {
    if (allDone) return;
    let firstSeen = 0;
    try {
      const raw = window.localStorage.getItem(SEEN_KEY);
      if (raw) {
        firstSeen = Number(raw);
      } else {
        firstSeen = Date.now();
        window.localStorage.setItem(SEEN_KEY, String(firstSeen));
      }
    } catch {
      firstSeen = Date.now();
    }
    const days = (Date.now() - firstSeen) / 86_400_000;
    const stuck = days >= 3 && doneCount <= Math.ceil(total / 2);
    setStruggling(stuck);
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* ignore */
    }
    // Struggling users see the nudge again even if they dismissed the welcome.
    setShow(stuck || !dismissed);
  }, [allDone, doneCount, total]);

  if (!show || allDone) return null;

  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={`guide-banner${struggling ? " struggling" : ""}`}>
      <span className="guide-banner-ic">{Icons.book}</span>
      <div className="guide-banner-body">
        <div className="guide-banner-title">
          {struggling ? "Need a hand getting set up?" : "New to StackUp? Start here"}
        </div>
        <div className="guide-banner-sub">
          {struggling
            ? "You've still got a few setup steps left. The guide walks through everything, step by step."
            : "The guide explains the whole product — from tasks all the way up to spaces. Perfect for you and your team."}
        </div>
      </div>
      <Link href="/guide" className="btn btn-primary btn-sm guide-banner-cta">
        Open the guide
      </Link>
      <button type="button" className="guide-banner-x" aria-label="Dismiss" onClick={dismiss}>
        {Icons.close}
      </button>
    </div>
  );
}

/** A private, device-local scratchpad card. */
function NotepadCard() {
  const KEY = "stackup.home.notepad";
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      setText(window.localStorage.getItem(KEY) ?? "");
    } catch {
      /* ignore */
    }
  }, []);

  const onChange = (v: string) => {
    setText(v);
    try {
      window.localStorage.setItem(KEY, v);
      setSaved(true);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="notepad">
      <textarea
        className="notepad-area"
        value={text}
        placeholder="Jot down a quick note, a link, a reminder…"
        onChange={(e) => onChange(e.target.value)}
        rows={5}
      />
      <div className="notepad-foot muted">
        {saved ? "Saved on this device" : "Private to this device"}
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
