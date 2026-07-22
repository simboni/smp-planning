"use client";

/**
 * StackUp Knowledge Base — a self-contained, shareable guide that explains the
 * whole product to a new person or organization, from the Task (the basic unit)
 * all the way up to the Workspace. This is a PUBLIC route (outside the (app)
 * auth group), so a link to /guide can be sent to anyone — no login required —
 * yet it lives entirely inside StackUp with no external branding.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icons, StackMark, type IconKey } from "@/components/icons";
import { getAccessToken } from "@/lib/api";

type Section = { id: string; label: string; icon: IconKey };

const SECTIONS: Section[] = [
  { id: "intro", label: "What is StackUp?", icon: "sparkles" },
  { id: "hierarchy", label: "The hierarchy", icon: "spaces" },
  { id: "tasks", label: "Tasks — the basic unit", icon: "tasks" },
  { id: "views", label: "Views", icon: "list" },
  { id: "docs", label: "Docs & Wikis", icon: "docs" },
  { id: "whiteboards", label: "Whiteboards & Mind maps", icon: "whiteboard" },
  { id: "goals", label: "Goals & Portfolios", icon: "goals" },
  { id: "dashboards", label: "Dashboards & Sprints", icon: "dashboards" },
  { id: "time", label: "Time & Workload", icon: "clock" },
  { id: "forms", label: "Forms & Automations", icon: "bolt" },
  { id: "collab", label: "Chat & Collaboration", icon: "chat" },
  { id: "admin", label: "Members, roles & admin", icon: "members" },
  { id: "quickstart", label: "Get started in 5 steps", icon: "checkCircle" },
  { id: "glossary", label: "Glossary", icon: "book" },
];

export default function GuidePage() {
  const [active, setActive] = useState<string>("intro");
  const [navOpen, setNavOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(Boolean(getAccessToken()));
  }, []);

  // Scroll-spy: highlight the section currently in view.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const go = (id: string) => {
    setNavOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="kb">
      {/* Top bar */}
      <header className="kb-topbar">
        <Link href="/" className="kb-brand" aria-label="StackUp home">
          <span className="kb-brand-mark">
            <StackMark />
          </span>
          <span className="kb-brand-name">
            Stack<span className="up">Up</span>
          </span>
          <span className="kb-brand-tag">Guide</span>
        </Link>
        <div className="kb-topbar-actions">
          <button
            type="button"
            className="kb-nav-toggle"
            aria-label="Contents"
            onClick={() => setNavOpen((v) => !v)}
          >
            {Icons.list}
          </button>
          {signedIn ? (
            <Link href="/dashboard" className="btn btn-primary btn-sm">
              Back to app
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm kb-hide-sm">
                Sign in
              </Link>
              <Link href="/login" className="btn btn-primary btn-sm">
                Get started free
              </Link>
            </>
          )}
        </div>
      </header>

      <div className="kb-shell">
        {/* Sidebar table of contents */}
        <aside className={`kb-toc${navOpen ? " open" : ""}`}>
          <nav aria-label="Contents">
            <div className="kb-toc-label">On this page</div>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`kb-toc-link${active === s.id ? " active" : ""}`}
                onClick={() => go(s.id)}
              >
                <span className="kb-toc-ic">{Icons[s.icon]}</span>
                {s.label}
              </button>
            ))}
          </nav>
        </aside>
        {navOpen && <div className="kb-scrim" onClick={() => setNavOpen(false)} />}

        {/* Content */}
        <main className="kb-main">
          <Hero />
          <Intro />
          <Hierarchy />
          <Tasks />
          <Views />
          <Docs />
          <Whiteboards />
          <Goals />
          <Dashboards />
          <TimeWorkload />
          <FormsAutomations />
          <Collab />
          <Admin />
          <QuickStart signedIn={signedIn} />
          <Glossary />

          <footer className="kb-foot">
            <div className="kb-foot-cta">
              <h3>Ready to put it to work?</h3>
              <p>Spin up your workspace and bring your team along.</p>
              <Link href={signedIn ? "/dashboard" : "/login"} className="btn btn-primary">
                {signedIn ? "Open StackUp" : "Get started free"}
              </Link>
            </div>
            <div className="kb-foot-mark">
              <span className="kb-brand-mark sm">
                <StackMark />
              </span>
              StackUp — one app to plan, track, and get work done.
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Content sections. Each is a plain function component so the copy is
 * easy to read and maintain in one place.
 * ------------------------------------------------------------------ */

function Hero() {
  return (
    <div className="kb-hero">
      <span className="kb-hero-badge">Product guide</span>
      <h1>Everything you need to run work in one place</h1>
      <p>
        StackUp is a single home for your team&apos;s projects, knowledge and
        communication. This guide walks you through the whole product — from the
        smallest building block, the <strong>task</strong>, all the way up to
        how an entire organization is structured. No jargon, no prior setup
        needed: read top to bottom and you&apos;ll understand how it all fits.
      </p>
      <div className="kb-hero-chips">
        <span className="kb-chip">Tasks &amp; projects</span>
        <span className="kb-chip">Docs &amp; whiteboards</span>
        <span className="kb-chip">Goals &amp; dashboards</span>
        <span className="kb-chip">Chat &amp; automation</span>
      </div>
    </div>
  );
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="kb-section">
      {eyebrow && <div className="kb-eyebrow">{eyebrow}</div>}
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function FeatureList({ items }: { items: [string, string][] }) {
  return (
    <ul className="kb-featlist">
      {items.map(([term, desc]) => (
        <li key={term}>
          <span className="kb-feat-check">{Icons.check}</span>
          <span>
            <strong>{term}</strong> — {desc}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Intro() {
  return (
    <Section id="intro" eyebrow="Start here" title="What is StackUp?">
      <p className="kb-lead">
        StackUp replaces the scatter of separate tools — a task tracker here, a
        docs app there, a chat tool, a spreadsheet of goals — with one connected
        workspace. Your work lives in a clear structure, every team can see what
        matters to them, and leaders get a real-time picture without chasing
        status updates.
      </p>
      <div className="kb-callout">
        <span className="kb-callout-ic">{Icons.sparkles}</span>
        <div>
          <strong>The one-line version:</strong> plan work as tasks, organize
          tasks into lists and spaces, look at them however suits the job, and
          layer on docs, goals, dashboards, chat and automation as you grow.
        </div>
      </div>
    </Section>
  );
}

function Hierarchy() {
  return (
    <Section
      id="hierarchy"
      eyebrow="Core concept"
      title="How everything is organized"
    >
      <p>
        StackUp nests from the big container down to the smallest piece of work.
        Think of it like an organization: the company holds departments,
        departments hold teams, teams keep projects, and projects are made of
        individual jobs to do.
      </p>

      <div className="kb-ladder">
        {[
          ["Workspace", "Your whole organization. Everyone and everything lives inside it.", "team"],
          ["Space", "A department or big area of work (e.g. Marketing, Product, Operations).", "spaces"],
          ["Folder", "An optional grouping inside a space — a campaign, a client, a quarter.", "folder"],
          ["List", "Where tasks actually live — a project, a backlog, a pipeline.", "list"],
          ["Task", "The basic unit of work: one thing to do, with an owner and a due date.", "tasks"],
        ].map(([name, desc, icon], i) => (
          <div key={name} className={`kb-ladder-row depth-${i}`}>
            <span className="kb-ladder-ic">{Icons[icon as IconKey]}</span>
            <div className="kb-ladder-body">
              <div className="kb-ladder-name">{name}</div>
              <div className="kb-ladder-desc">{desc}</div>
            </div>
            {i < 4 && <span className="kb-ladder-arrow">{Icons.chevronDown}</span>}
          </div>
        ))}
      </div>

      <p className="kb-note">
        You don&apos;t have to use every level — small teams often work with a
        space and a couple of lists. The structure is there to grow into.
      </p>
    </Section>
  );
}

function Tasks() {
  return (
    <Section id="tasks" eyebrow="The building block" title="Tasks — the basic unit">
      <p>
        A task is one piece of work. Everything else in StackUp exists to help
        you organize, track and get tasks done. A task is far more than a
        checkbox — it carries all the context a job needs.
      </p>
      <FeatureList
        items={[
          ["Status", "move a task through your workflow (To do → In progress → Done), fully customizable per space."],
          ["Priority", "flag what matters — Urgent, High, Normal, Low."],
          ["Assignees", "give a task one or more owners so it's clear who's on it."],
          ["Dates", "start and due dates keep work on schedule; overdue work surfaces automatically."],
          ["Subtasks & checklists", "break big work into smaller steps and tick them off."],
          ["Custom fields", "add your own data — budget, client, story points, a dropdown, a URL."],
          ["Dependencies", "mark that one task is blocked by or waiting on another."],
          ["Recurrence", "have routine tasks recreate themselves on a schedule."],
          ["Tags", "label tasks across lists so you can slice work any way you like."],
          ["Comments & attachments", "discuss the work and keep files right where the work is."],
        ]}
      />
      <div className="kb-callout subtle">
        <span className="kb-callout-ic">{Icons.tasks}</span>
        <div>
          <strong>Milestones</strong> are special tasks that mark a key moment —
          a launch, a deadline, a hand-off — and stand out on timelines.
        </div>
      </div>
    </Section>
  );
}

function Views() {
  return (
    <Section id="views" eyebrow="See work your way" title="Views">
      <p>
        The same tasks can be viewed in whatever shape fits the moment. Switch
        between views without moving any data — it&apos;s one set of tasks, many
        lenses.
      </p>
      <div className="kb-cards">
        {[
          ["List", "A clean, groupable list — the everyday workhorse.", "list"],
          ["Board", "Kanban columns by status; drag cards across the flow.", "dashboards"],
          ["Calendar", "Tasks on a calendar by their dates.", "calendar"],
          ["Table", "A spreadsheet-style grid of tasks and fields.", "list"],
          ["Gantt", "Plan across time and see dependencies.", "clock"],
          ["Timeline", "A horizontal schedule of who's doing what, when.", "clock"],
        ].map(([t, d, ic]) => (
          <div key={t} className="kb-card">
            <span className="kb-card-ic">{Icons[ic as IconKey]}</span>
            <div className="kb-card-title">{t}</div>
            <div className="kb-card-desc">{d}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Docs() {
  return (
    <Section id="docs" eyebrow="Knowledge" title="Docs & Wikis">
      <p>
        Docs are for the knowledge around your work — project briefs, meeting
        notes, processes, wikis. They live alongside your tasks, so context and
        execution stay in the same place instead of a separate app.
      </p>
      <FeatureList
        items={[
          ["Rich pages", "headings, lists, checklists and formatting for readable documents."],
          ["Nested pages", "build a wiki with pages inside pages."],
          ["Attached to spaces", "keep a space's docs with its work, or keep them workspace-wide."],
          ["Notepad", "a quick personal scratchpad for notes that aren't ready to share."],
        ]}
      />
    </Section>
  );
}

function Whiteboards() {
  return (
    <Section id="whiteboards" eyebrow="Think visually" title="Whiteboards & Mind maps">
      <p>
        When you need to brainstorm, map a process or plan visually, whiteboards
        give you an infinite canvas with sticky notes, shapes, text and
        connectors. Mind maps help you branch ideas out from a central topic.
      </p>
      <FeatureList
        items={[
          ["Infinite canvas", "sticky notes, rectangles, ellipses, text and arrows."],
          ["Live collaboration", "changes sync so the team can build together."],
          ["Attached to a space", "keep a board with the work it belongs to."],
          ["Mind maps", "expand ideas from a central node into branches."],
        ]}
      />
    </Section>
  );
}

function Goals() {
  return (
    <Section id="goals" eyebrow="Direction" title="Goals, OKRs & Portfolios">
      <p>
        Goals connect day-to-day work to the outcomes you care about. Set a
        target, tie it to the tasks that move it, and watch progress roll up
        automatically. Portfolios group related projects for a leadership view.
      </p>
      <FeatureList
        items={[
          ["Measurable targets", "track a number, a percentage, or task completion."],
          ["Linked to work", "progress updates as the underlying tasks move."],
          ["Folders & OKRs", "organize goals by team or quarter."],
          ["Portfolios", "a roll-up of many projects' health in one place."],
        ]}
      />
    </Section>
  );
}

function Dashboards() {
  return (
    <Section id="dashboards" eyebrow="The big picture" title="Dashboards & Sprints">
      <p>
        Dashboards turn your live data into charts and numbers — no exports, no
        spreadsheets. Build a view for a team, a project or a leadership
        review. Sprints support teams working in time-boxed cycles.
      </p>
      <FeatureList
        items={[
          ["Cards & charts", "task counts, status breakdowns, workload, burn-down and more."],
          ["Always live", "every card reflects the current state of your work."],
          ["Sprints", "plan work into cycles with points and velocity."],
          ["Custom home", "your personal Home page is a dashboard you can add cards to."],
        ]}
      />
    </Section>
  );
}

function TimeWorkload() {
  return (
    <Section id="time" eyebrow="Capacity" title="Time tracking, Timesheets & Workload">
      <p>
        Understand where time goes and whether the team is balanced. Track time
        against tasks, review it on timesheets, and see capacity at a glance so
        no one is buried while others have room.
      </p>
      <FeatureList
        items={[
          ["Time tracking", "log time on any task, manually or with a timer."],
          ["Timesheets", "review and submit time by day or week."],
          ["Workload", "a visual read of who is over- or under-loaded."],
        ]}
      />
    </Section>
  );
}

function FormsAutomations() {
  return (
    <Section id="forms" eyebrow="Intake & flow" title="Forms & Automations">
      <p>
        Forms let anyone submit work into StackUp — a request, a bug, an intake —
        which lands as a task automatically. Automations remove busywork by
        reacting to changes: when something happens, do something.
      </p>
      <FeatureList
        items={[
          ["Forms", "share a link; submissions become tasks in the list you choose."],
          ["Automations", "e.g. \"when status becomes Done, notify the requester.\""],
          ["Triggers & actions", "chain conditions to fit your process."],
        ]}
      />
    </Section>
  );
}

function Collab() {
  return (
    <Section id="collab" eyebrow="Together" title="Chat & Collaboration">
      <p>
        Conversation lives next to the work, not in a separate silo. Chat in
        channels, comment on tasks, and get notified about what needs you — all
        in real time.
      </p>
      <FeatureList
        items={[
          ["Chat", "channels for teams and topics, with files and reactions."],
          ["Comments", "discuss a task right on the task, with @mentions."],
          ["Real-time", "changes appear live as teammates work."],
          ["Inbox & notifications", "one place for everything that needs your attention."],
        ]}
      />
    </Section>
  );
}

function Admin() {
  return (
    <Section id="admin" eyebrow="Run it well" title="Members, roles & administration">
      <p>
        Invite your organization and control who can do what. Roles keep things
        safe and simple, and admins get the tools to manage the workspace as it
        grows.
      </p>
      <div className="kb-roles">
        {[
          ["Owner", "Full control, including billing and deleting the workspace."],
          ["Admin", "Manage members, spaces and settings."],
          ["Member", "Do the work — create and collaborate across spaces."],
          ["Guest", "Limited, space-scoped access for outside collaborators."],
        ].map(([r, d]) => (
          <div key={r} className="kb-role">
            <span className={`badge role-${r.toLowerCase()}`}>{r}</span>
            <span>{d}</span>
          </div>
        ))}
      </div>
      <FeatureList
        items={[
          ["Member management", "invite, change roles, suspend or remove people."],
          ["Security", "two-factor authentication and active-session control."],
          ["Audit log", "a tamper-evident record of every change."],
          ["Plans & limits", "choose the plan that fits; usage is always visible."],
        ]}
      />
    </Section>
  );
}

function QuickStart({ signedIn }: { signedIn: boolean }) {
  const steps: [string, string, string][] = [
    ["Create your workspace", "This is your organization's home base.", "/dashboard"],
    ["Set up a Space", "Add your first department or area of work.", "/everything"],
    ["Add a List and Tasks", "Create a project list and add real work to it.", "/everything"],
    ["Invite your team", "Bring people in and assign roles.", "/members"],
    ["Pick a view & track", "See work as a list, board or calendar and keep it moving.", "/my-work"],
  ];
  return (
    <Section id="quickstart" eyebrow="Do it now" title="Get started in 5 steps">
      <ol className="kb-steps">
        {steps.map(([t, d, href], i) => (
          <li key={t} className="kb-step">
            <span className="kb-step-num">{i + 1}</span>
            <div className="kb-step-body">
              <div className="kb-step-title">{t}</div>
              <div className="kb-step-desc">{d}</div>
            </div>
            {signedIn && (
              <Link href={href} className="btn btn-soft btn-sm">
                Open
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Glossary() {
  const terms: [string, string][] = [
    ["Workspace", "Your whole organization in StackUp — the top-level container."],
    ["Space", "A major area of work, like a department."],
    ["Folder", "An optional grouping of lists inside a space."],
    ["List", "Where tasks live — a project, backlog or pipeline."],
    ["Task", "The basic unit of work; one thing to do."],
    ["Subtask", "A smaller task nested under a parent task."],
    ["Status", "Where a task sits in your workflow (e.g. In progress)."],
    ["View", "A way of looking at tasks — list, board, calendar, timeline."],
    ["Custom field", "Your own data column on a task."],
    ["Dependency", "A link showing one task is blocked by another."],
    ["Milestone", "A special task marking a key moment."],
    ["Sprint", "A time-boxed cycle of work."],
    ["Goal", "A measurable outcome tied to your work."],
    ["Dashboard", "A live board of charts and numbers."],
    ["Doc", "A rich page for knowledge and notes."],
    ["Whiteboard", "An infinite visual canvas for ideas."],
    ["Automation", "A rule that acts on changes automatically."],
    ["Form", "A shareable intake that creates tasks."],
    ["Guest", "An outside collaborator with limited access."],
  ];
  return (
    <Section id="glossary" eyebrow="Reference" title="Glossary">
      <dl className="kb-glossary">
        {terms.map(([term, def]) => (
          <div key={term} className="kb-gloss-item">
            <dt>{term}</dt>
            <dd>{def}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
