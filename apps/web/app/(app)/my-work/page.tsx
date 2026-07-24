"use client";

/**
 * Module 14 — Home / My Work. A personal dashboard: greeting, a stat strip
 * (assigned open / overdue / due today), then task sections (Overdue, Due
 * today, Next 7 days, Unscheduled) plus Reminders and Recent activity.
 *
 * Task rows are compact and navigate to their list (panels are component
 * state, so we deep-link `/list?id=<listId>&task=<id>`).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getUser,
  homeApi,
  tasksApi,
  type HomeData,
  type TaskCard,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { AvatarStack, DueChip, PriorityFlag } from "@/components/TaskBits";
import { colorFor, firstName, formatDateTime, timeAgo } from "@/lib/format";

function CompactRow({ task, onChanged }: { task: TaskCard; onChanged: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const done = task.status?.type === "done";
  const dot = task.status?.color || colorFor(task.statusId);

  // Complete / reopen straight from My Work — the module's primary action.
  const toggle = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await tasksApi.toggleDone(task.id);
      onChanged();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`mw-task${done ? " done" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/list?id=${task.listId}&task=${task.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(`/list?id=${task.listId}&task=${task.id}`);
      }}
    >
      <button
        type="button"
        className={`mw-task-check${done ? " done" : ""}`}
        style={done ? undefined : { borderColor: dot }}
        title={done ? "Mark as not done" : "Mark as done"}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        onClick={toggle}
        disabled={busy}
      >
        {done ? Icons.check : null}
      </button>
      <span className="mw-task-name">{task.name}</span>
      <span className="mw-task-meta">
        <PriorityFlag priority={task.priority} />
        <DueChip due={task.dueDate} />
        <AvatarStack users={task.assignees} size={22} />
      </span>
    </div>
  );
}

function Section({
  title,
  icon,
  tone,
  tasks,
  onChanged,
}: {
  title: string;
  icon: keyof typeof Icons;
  tone?: "danger" | "warn";
  tasks: TaskCard[];
  onChanged: () => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div className={`mw-section${tone ? ` mw-${tone}` : ""}`}>
      <div className="mw-section-head">
        <span className="mw-section-ic">{Icons[icon]}</span>
        <h3>{title}</h3>
        <span className="badge badge-soft">{tasks.length}</span>
      </div>
      <div className="mw-tasks">
        {tasks.map((t) => (
          <CompactRow key={t.id} task={t} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

export default function MyWorkPage() {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState("");
  const name = firstName(getUser()?.fullName ?? "");

  const reload = (): void => {
    homeApi
      .get()
      .then(setData)
      .catch(() => setError("Couldn't load your work right now."));
  };

  useEffect(() => {
    reload();
  }, []);

  if (error) {
    return (
      <div className="page">
        <div className="form-error">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <span className="skel" style={{ width: 260, height: 34, marginBottom: 18 }} />
        <span className="skel" style={{ width: "100%", height: 74, marginBottom: 16 }} />
        <span className="skel" style={{ width: "100%", height: 120, marginBottom: 10 }} />
        <span className="skel" style={{ width: "100%", height: 120 }} />
      </div>
    );
  }

  const totalTasks =
    data.overdue.length + data.dueToday.length + data.upcoming.length + data.unscheduled.length;

  return (
    <div className="page mw-page">
      <div className="mw-hero">
        <div>
          <h1>Good to see you, {name} 👋</h1>
          <p className="muted">Here's what's on your plate.</p>
        </div>
      </div>

      {/* stat strip */}
      <div className="mw-stats">
        <div className="mw-stat">
          <span className="mw-stat-num">{data.assignedOpen}</span>
          <span className="mw-stat-label">Assigned & open</span>
        </div>
        <div className={`mw-stat${data.overdue.length ? " danger" : ""}`}>
          <span className="mw-stat-num">{data.overdue.length}</span>
          <span className="mw-stat-label">Overdue</span>
        </div>
        <div className="mw-stat">
          <span className="mw-stat-num">{data.dueToday.length}</span>
          <span className="mw-stat-label">Due today</span>
        </div>
      </div>

      <div className="mw-grid">
        <div className="mw-col">
          {totalTasks === 0 ? (
            <div className="card">
              <div className="empty-state">
                <span className="empty-ic">{Icons.checkCircle}</span>
                <h3>You're all clear</h3>
                <p>No tasks assigned to you right now. Enjoy the calm.</p>
                <Link href="/everything" className="btn btn-soft">Browse spaces</Link>
              </div>
            </div>
          ) : (
            <>
              <Section title="Overdue" icon="ban" tone="danger" tasks={data.overdue} onChanged={reload} />
              <Section title="Due today" icon="calendar" tone="warn" tasks={data.dueToday} onChanged={reload} />
              <Section title="Next 7 days" icon="clock" tasks={data.upcoming} onChanged={reload} />
              <Section title="Unscheduled" icon="inbox" tasks={data.unscheduled} onChanged={reload} />
            </>
          )}
        </div>

        <div className="mw-col mw-side">
          {/* Reminders */}
          <div className="card mw-panel">
            <div className="card-head">
              <h3>{Icons.bell} Reminders</h3>
            </div>
            {data.reminders.length === 0 ? (
              <div className="mw-empty">No reminders set.</div>
            ) : (
              <div className="mw-reminders">
                {data.reminders.map((r) => (
                  <div key={r.id} className="mw-reminder">
                    <span className="mw-reminder-when">{formatDateTime(r.remindAt)}</span>
                    <span className="mw-reminder-note">{r.note}</span>
                    {r.taskId && r.taskName && (
                      <button
                        type="button"
                        className="mw-reminder-task"
                        onClick={() => router.push(`/list?task=${r.taskId}`)}
                        title={r.taskName}
                      >
                        {Icons.tasks} {r.taskName}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent */}
          <div className="card mw-panel">
            <div className="card-head">
              <h3>{Icons.clock} Recent</h3>
            </div>
            {data.recent.length === 0 ? (
              <div className="mw-empty">Nothing recent yet.</div>
            ) : (
              <div className="mw-recent">
                {data.recent.map((r) => (
                  <button
                    key={`${r.taskId}-${r.createdAt}`}
                    type="button"
                    className="mw-recent-row"
                    onClick={() => router.push(`/list?id=${r.listId}&task=${r.taskId}`)}
                  >
                    <span className="mw-recent-ic">{Icons.tasks}</span>
                    <span className="mw-recent-body">
                      <span className="mw-recent-name">{r.taskName}</span>
                      <span className="mw-recent-meta">
                        {r.kind} · {timeAgo(r.createdAt)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
