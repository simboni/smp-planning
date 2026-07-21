"use client";

/**
 * Inbox (Module 6) — the full notification center plus personal
 * reminders. Tabs All / Unread; clicking a notification marks it read
 * and, when it points at a task, jumps to that task's list with the
 * panel open (/list?id=<listId>&task=<taskId>). Reminders live below:
 * note + when + optional linked task, a done checkbox, and an inline
 * "+ Reminder" form. `notification.new` events refetch live.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  notificationsApi,
  remindersApi,
  tasksApi,
  type AppNotification,
  type Reminder,
} from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";
import { colorFor, formatDateTime, timeAgo } from "@/lib/format";
import { Avatar } from "@/components/Avatar";

type Tab = "all" | "unread";

export default function InboxPage() {
  const router = useRouter();

  const [notifications, setNotifications] = useState<AppNotification[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [error, setError] = useState("");

  // Inline reminder form.
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [savingReminder, setSavingReminder] = useState(false);

  const loadNotifications = (): void => {
    notificationsApi
      .list()
      .then((r) => {
        setNotifications(r.notifications);
        setUnreadCount(r.unreadCount);
        setError("");
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load your inbox."),
      );
  };
  const loadReminders = (): void => {
    remindersApi
      .list()
      .then((r) =>
        setReminders(
          [...r.reminders].sort(
            (a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime(),
          ),
        ),
      )
      .catch(() => setReminders([]));
  };

  useEffect(() => {
    loadNotifications();
    loadReminders();
  }, []);

  useRealtime((e) => {
    if (e.type === "notification.new") loadNotifications();
  }, []);

  const shown = useMemo(() => {
    const all = notifications ?? [];
    return tab === "unread" ? all.filter((n) => !n.readAt) : all;
  }, [notifications, tab]);

  /* -- notification actions ------------------------------------------ */
  const markRead = (n: AppNotification): void => {
    if (n.readAt) return;
    setNotifications((prev) =>
      (prev ?? []).map((x) =>
        x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x,
      ),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    notificationsApi.markRead(n.id).catch(() => loadNotifications());
  };

  const openNotification = (n: AppNotification): void => {
    markRead(n);
    if (n.taskId) {
      tasksApi
        .get(n.taskId)
        .then((r) => router.push(`/list?id=${r.task.listId}&task=${r.task.id}`))
        .catch(() => undefined); // task gone / no access → stay here, it's read now
    }
  };

  const markAllRead = (): void => {
    setNotifications((prev) =>
      (prev ?? []).map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
    );
    setUnreadCount(0);
    notificationsApi.markAllRead().catch(() => loadNotifications());
  };

  /* -- reminder actions ---------------------------------------------- */
  const addReminder = (): void => {
    const v = note.trim();
    if (!v || !remindAt || savingReminder) return;
    setSavingReminder(true);
    remindersApi
      .create({ note: v, remindAt: new Date(remindAt).toISOString() })
      .then(() => {
        setNote("");
        setRemindAt("");
        setAdding(false);
        loadReminders();
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't create the reminder."),
      )
      .finally(() => setSavingReminder(false));
  };

  const toggleReminderDone = (r: Reminder): void => {
    const done = r.doneAt === null;
    setReminders((prev) =>
      (prev ?? []).map((x) =>
        x.id === r.id ? { ...x, doneAt: done ? new Date().toISOString() : null } : x,
      ),
    );
    remindersApi.update(r.id, { done }).catch(() => loadReminders());
  };

  const deleteReminder = (r: Reminder): void => {
    setReminders((prev) => (prev ?? []).filter((x) => x.id !== r.id));
    remindersApi.remove(r.id).catch(() => loadReminders());
  };

  const openReminderTask = (r: Reminder): void => {
    if (!r.taskId) return;
    tasksApi
      .get(r.taskId)
      .then((res) => router.push(`/list?id=${res.task.listId}&task=${res.task.id}`))
      .catch(() => undefined);
  };

  const overdue = (r: Reminder): boolean =>
    r.doneAt === null && new Date(r.remindAt).getTime() < Date.now();

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Inbox</h1>
          <p className="sub">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "You're all caught up."}
          </p>
        </div>
        {unreadCount > 0 && (
          <button type="button" className="btn btn-soft btn-sm" onClick={markAllRead}>
            {Icons.checkCircle} Mark all read
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {/* tabs */}
      <div className="cm-tabs inbox-tabs" role="tablist" aria-label="Notifications">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "all"}
          className={`cm-tab${tab === "all" ? " on" : ""}`}
          onClick={() => setTab("all")}
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "unread"}
          className={`cm-tab${tab === "unread" ? " on" : ""}`}
          onClick={() => setTab("unread")}
        >
          Unread
          {unreadCount > 0 && <span className="tp-count-badge">{unreadCount}</span>}
        </button>
      </div>

      {/* notifications */}
      <div className="card inbox-card">
        {notifications === null ? (
          <>
            <span className="skel" style={{ width: "100%", height: 52, marginBottom: 8 }} />
            <span className="skel" style={{ width: "100%", height: 52 }} />
          </>
        ) : shown.length === 0 ? (
          <div className="empty-state">
            <span className="empty-ic">{Icons.inbox}</span>
            <h3>{tab === "unread" ? "No unread notifications" : "Nothing here yet"}</h3>
            <p>
              {tab === "unread"
                ? "New mentions, assignments and updates will land here."
                : "When teammates mention you, assign you or update your tasks, you'll see it here."}
            </p>
          </div>
        ) : (
          <div className="inbox-list">
            {shown.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`notif-row${n.readAt ? "" : " unread"}`}
                onClick={() => openNotification(n)}
              >
                {n.actor ? (
                  <Avatar
                    name={n.actor.fullName}
                    id={n.actor.id}
                    avatarUrl={n.actor.avatarUrl}
                    className="avatar-sm"
                  />
                ) : (
                  <span className="avatar avatar-sm" style={{ background: colorFor("sys") }}>
                    •
                  </span>
                )}
                <span className="notif-body">
                  <span className="notif-msg">{n.message}</span>
                  <span className="notif-meta">
                    {n.taskName && <span className="notif-task">{n.taskName}</span>}
                    <span className="notif-time">{timeAgo(n.createdAt)}</span>
                  </span>
                </span>
                {!n.readAt && <span className="notif-dot" aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* reminders */}
      <div className="inbox-section-head">
        <h2>{Icons.clock} Reminders</h2>
        {!adding && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            {Icons.plus} Reminder
          </button>
        )}
      </div>
      <div className="card inbox-card">
        {adding && (
          <div className="reminder-form">
            <input
              autoFocus
              className="input"
              placeholder="Remind me to…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addReminder();
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <input
              type="datetime-local"
              className="input reminder-when"
              value={remindAt}
              onChange={(e) => setRemindAt(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!note.trim() || !remindAt || savingReminder}
              onClick={addReminder}
            >
              Add
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setAdding(false);
                setNote("");
                setRemindAt("");
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {reminders === null ? (
          <span className="skel" style={{ width: "100%", height: 44 }} />
        ) : reminders.length === 0 && !adding ? (
          <div className="empty-state">
            <span className="empty-ic">{Icons.clock}</span>
            <h3>No reminders</h3>
            <p>Nudge future-you: add a note and pick a time.</p>
          </div>
        ) : (
          <div className="inbox-list">
            {reminders.map((r) => (
              <div key={r.id} className={`reminder-row${r.doneAt ? " done" : ""}`}>
                <button
                  type="button"
                  className={`tp-item-check${r.doneAt ? " on" : ""}`}
                  aria-label={r.doneAt ? "Mark not done" : "Mark done"}
                  onClick={() => toggleReminderDone(r)}
                >
                  {r.doneAt && Icons.check}
                </button>
                <span className="reminder-note">{r.note}</span>
                {r.taskId && r.taskName && (
                  <button
                    type="button"
                    className="reminder-task"
                    title="Open task"
                    onClick={() => openReminderTask(r)}
                  >
                    {Icons.list} {r.taskName}
                  </button>
                )}
                <span
                  className={`reminder-when-chip${overdue(r) ? " overdue" : ""}`}
                  title={new Date(r.remindAt).toLocaleString()}
                >
                  {Icons.clock} {formatDateTime(r.remindAt)}
                </span>
                <button
                  type="button"
                  className="icon-btn reminder-del"
                  title="Delete reminder"
                  onClick={() => deleteReminder(r)}
                >
                  {Icons.trash}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
