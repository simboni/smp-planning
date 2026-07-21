"use client";

/**
 * Module 6 — the Comments & Activity section at the bottom of the Task
 * panel. Two tabs:
 *
 *   Comments — chronological thread with one-level replies, @mention
 *   chips (tokens `@[userId]` in the body, resolved against the
 *   workspace member list), author-only inline edit & delete, and
 *   "assigned comments" that can be resolved/reopened. The composer
 *   supports an @ button (or just typing '@') that opens a member
 *   picker and inserts the token, an assign-to toggle, and Ctrl/Cmd+
 *   Enter to send. Hidden entirely when the viewer only has 'view'
 *   permission on the space.
 *
 *   Activity — a compact feed ("Maya changed status: To Do → In
 *   Progress · 2h ago") with an icon per kind.
 *
 * Live: on `comment.changed` for this task the thread refetches; on
 * `task.changed` the activity feed refetches (the panel itself reloads
 * the detail).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  commentsApi,
  getUser,
  type ActivityEntry,
  type ActivityKind,
  type Member,
  type TaskComment,
} from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";
import { timeAgo } from "@/lib/format";
import { Avatar } from "@/components/Avatar";

/* ------------------------------------------------------------------ *
 * Mention rendering — `@[userId]` tokens become purple @Name chips.
 * ------------------------------------------------------------------ */
const MENTION_RE = /@\[([^\]\s]+)\]/g;

export function renderMentions(
  body: string,
  nameOf: (userId: string) => string | null,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(body)) !== null) {
    if (m.index > last) parts.push(body.slice(last, m.index));
    const name = nameOf(m[1]);
    parts.push(
      <span key={key++} className="mention-chip">
        @{name ?? "someone"}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts.length > 0 ? parts : body;
}

/* ------------------------------------------------------------------ *
 * A tiny single-pick member popover (mentions & comment assignment).
 * ------------------------------------------------------------------ */
function MemberPop({
  members,
  title,
  onPick,
  onClose,
}: {
  members: Member[];
  title: string;
  onPick: (m: Member) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const hits = members.filter((m) =>
    !needle ? true : `${m.fullName} ${m.email}`.toLowerCase().includes(needle),
  );
  return (
    <div className="tp-pop tp-pop-people cm-mention-pop" ref={ref}>
      <div className="tp-pop-search">
        {Icons.atSign}
        <input
          autoFocus
          className="tp-pop-input"
          placeholder={title}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="tp-pop-list">
        {hits.length === 0 ? (
          <div className="tp-pop-empty">No people match.</div>
        ) : (
          hits.map((m) => (
            <button
              key={m.id}
              type="button"
              className="tp-pop-opt"
              onClick={() => onPick(m)}
            >
              <Avatar
                name={m.fullName || m.email}
                id={m.id}
                avatarUrl={m.avatarUrl}
                className="avatar-sm"
              />
              <span className="tp-pop-opt-body">
                <span className="tp-pop-opt-name">{m.fullName || m.email}</span>
                <span className="tp-pop-opt-sub">{m.email}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Composer — new comments, replies and inline edits share this.
 * ------------------------------------------------------------------ */
function Composer({
  members,
  placeholder,
  initialBody = "",
  initialAssigneeId = null,
  allowAssign = false,
  submitLabel = "Comment",
  autoFocus = false,
  busy,
  onSubmit,
  onCancel,
}: {
  members: Member[];
  placeholder: string;
  initialBody?: string;
  initialAssigneeId?: string | null;
  allowAssign?: boolean;
  submitLabel?: string;
  autoFocus?: boolean;
  busy: boolean;
  onSubmit: (body: string, assigneeUserId: string | null) => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initialBody);
  const [assigneeId, setAssigneeId] = useState<string | null>(initialAssigneeId);
  const [pop, setPop] = useState<"mention" | "assign" | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const nameOf = (id: string): string | null =>
    members.find((m) => m.id === id)?.fullName ?? null;
  const assignee = assigneeId ? members.find((m) => m.id === assigneeId) : null;
  const hasMention = /@\[[^\]\s]+\]/.test(body);

  const insertMention = (m: Member): void => {
    const el = taRef.current;
    const token = `@[${m.id}] `;
    setBody((prev) => {
      const pos = el ? el.selectionStart : prev.length;
      const before = prev.slice(0, pos);
      const after = prev.slice(pos);
      // Typing '@' opened this popover — swallow that trigger character.
      const kept = before.endsWith("@") ? before.slice(0, -1) : before;
      return kept + token + after;
    });
    setPop(null);
    el?.focus();
  };

  const submit = (): void => {
    const v = body.trim();
    if (!v || busy) return;
    onSubmit(v, assigneeId);
    setBody("");
    setAssigneeId(null);
  };

  return (
    <div className="cm-composer">
      <textarea
        ref={taRef}
        className="cm-input"
        placeholder={placeholder}
        value={body}
        autoFocus={autoFocus}
        rows={2}
        disabled={busy}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "@" && !e.ctrlKey && !e.metaKey) setPop("mention");
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape" && onCancel) onCancel();
        }}
      />
      {hasMention && (
        <div className="cm-preview">
          <span className="cm-preview-label">Preview</span>
          <span className="cm-preview-body">{renderMentions(body, nameOf)}</span>
        </div>
      )}
      <div className="cm-composer-bar">
        <div className="tp-pop-anchor">
          <button
            type="button"
            className="icon-btn cm-tool"
            title="Mention someone"
            onClick={() => setPop(pop === "mention" ? null : "mention")}
          >
            {Icons.atSign}
          </button>
          {pop === "mention" && (
            <MemberPop
              members={members}
              title="Mention someone…"
              onPick={insertMention}
              onClose={() => setPop(null)}
            />
          )}
        </div>
        {allowAssign && (
          <div className="tp-pop-anchor">
            {assignee ? (
              <span className="cm-assignee-chip on">
                {Icons.userPlus}
                {assignee.fullName || assignee.email}
                <button
                  type="button"
                  className="cm-chip-x"
                  aria-label="Remove assignee"
                  onClick={() => setAssigneeId(null)}
                >
                  {Icons.close}
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="icon-btn cm-tool"
                title="Assign this comment to someone"
                onClick={() => setPop(pop === "assign" ? null : "assign")}
              >
                {Icons.userPlus}
              </button>
            )}
            {pop === "assign" && (
              <MemberPop
                members={members}
                title="Assign comment to…"
                onPick={(m) => {
                  setAssigneeId(m.id);
                  setPop(null);
                }}
                onClose={() => setPop(null)}
              />
            )}
          </div>
        )}
        <span className="cm-hint">⌘↵ to send</span>
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || !body.trim()}
          onClick={submit}
        >
          {Icons.send} {submitLabel}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One comment (and, indented, its replies).
 * ------------------------------------------------------------------ */
function CommentItem({
  c,
  isReply,
  meId,
  members,
  canComment,
  busy,
  onReply,
  onSaveEdit,
  onDelete,
  onToggleResolve,
}: {
  c: TaskComment;
  isReply: boolean;
  meId: string | null;
  members: Member[];
  canComment: boolean;
  busy: boolean;
  onReply: (parent: TaskComment, body: string) => void;
  onSaveEdit: (c: TaskComment, body: string) => void;
  onDelete: (c: TaskComment) => void;
  onToggleResolve: (c: TaskComment) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const mine = meId !== null && c.author.id === meId;
  const resolved = c.resolvedAt !== null;
  const nameOf = (id: string): string | null =>
    members.find((m) => m.id === id)?.fullName ?? null;

  return (
    <div className={`cm-item${isReply ? " reply" : ""}${resolved ? " resolved" : ""}`}>
      <Avatar
        name={c.author.fullName}
        id={c.author.id}
        avatarUrl={c.author.avatarUrl}
        className="avatar-sm cm-avatar"
        title={c.author.fullName}
      />
      <div className="cm-main">
        <div className="cm-head">
          <span className="cm-author">{c.author.fullName}</span>
          <span className="cm-time" title={new Date(c.createdAt).toLocaleString()}>
            {timeAgo(c.createdAt)}
          </span>
          {c.editedAt && <span className="cm-edited">(edited)</span>}
          {c.assignee && (
            <span className={`cm-assignee-chip${resolved ? "" : " on"}`}>
              {Icons.userPlus}
              {c.assignee.fullName}
            </span>
          )}
          {resolved && <span className="cm-resolved-tag">{Icons.check} Resolved</span>}
        </div>

        {editing ? (
          <Composer
            members={members}
            placeholder="Edit your comment…"
            initialBody={c.body}
            submitLabel="Save"
            autoFocus
            busy={busy}
            onSubmit={(body) => {
              setEditing(false);
              onSaveEdit(c, body);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="cm-body">{renderMentions(c.body, nameOf)}</div>
        )}

        {!editing && canComment && (
          <div className="cm-actions">
            {!isReply && (
              <button type="button" className="cm-action" onClick={() => setReplying((v) => !v)}>
                Reply
              </button>
            )}
            {mine && (
              <>
                <button type="button" className="cm-action" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="cm-action danger"
                  onClick={() => onDelete(c)}
                >
                  Delete
                </button>
              </>
            )}
            {c.assignee && (
              <button
                type="button"
                className={`cm-action cm-resolve${resolved ? " on" : ""}`}
                onClick={() => onToggleResolve(c)}
              >
                {Icons.checkCircle}
                {resolved ? "Reopen" : "Resolve"}
              </button>
            )}
          </div>
        )}

        {replying && (
          <Composer
            members={members}
            placeholder={`Reply to ${c.author.fullName}…`}
            submitLabel="Reply"
            autoFocus
            busy={busy}
            onSubmit={(body) => {
              setReplying(false);
              onReply(c, body);
            }}
            onCancel={() => setReplying(false)}
          />
        )}

        {(c.replies?.length ?? 0) > 0 && (
          <div className="cm-replies">
            {(c.replies ?? []).map((r) => (
              <CommentItem
                key={r.id}
                c={r}
                isReply
                meId={meId}
                members={members}
                canComment={canComment}
                busy={busy}
                onReply={onReply}
                onSaveEdit={onSaveEdit}
                onDelete={onDelete}
                onToggleResolve={onToggleResolve}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Activity feed helpers.
 * ------------------------------------------------------------------ */
const KIND_ICON: Record<ActivityKind, React.ReactNode> = {
  created: Icons.plus,
  status: Icons.circle,
  priority: Icons.flag,
  dates: Icons.calendar,
  assignee: Icons.members,
  name: Icons.edit,
  description: Icons.docs,
  archived: Icons.archive,
  completed: Icons.checkCircle,
  comment: Icons.chat,
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** "changed status: To Do → In Progress" — defensive against data shape. */
function describeActivity(
  entry: ActivityEntry,
  nameOf: (userId: string) => string | null,
): React.ReactNode {
  const d = entry.data ?? {};
  const from = str(d.from);
  const to = str(d.to);
  switch (entry.kind) {
    case "created":
      return "created this task";
    case "status":
      return from && to ? (
        <>
          changed status: <strong>{from}</strong> <span className="act-arrow">→</span>{" "}
          <strong>{to}</strong>
        </>
      ) : to ? (
        <>set status to <strong>{to}</strong></>
      ) : (
        "changed the status"
      );
    case "priority":
      return to ? (
        <>set priority to <strong>{to}</strong></>
      ) : from ? (
        "cleared the priority"
      ) : (
        "changed the priority"
      );
    case "dates":
      return "updated the dates";
    case "assignee": {
      const uid = str(d.userId);
      const who = (uid && nameOf(uid)) ?? str(d.userName);
      const removed = d.action === "removed" || d.removed === true;
      if (who) {
        return removed ? (
          <>removed <strong>{who}</strong> as assignee</>
        ) : (
          <>assigned <strong>{who}</strong></>
        );
      }
      return removed ? "removed an assignee" : "added an assignee";
    }
    case "name":
      return to ? (
        <>renamed this task to <strong>“{to}”</strong></>
      ) : (
        "renamed this task"
      );
    case "description":
      return "updated the description";
    case "archived":
      return d.archived === false ? "unarchived this task" : "archived this task";
    case "completed":
      return "completed this task";
    case "comment":
      return "commented";
    default:
      return "updated this task";
  }
}

/* ------------------------------------------------------------------ *
 * The section itself.
 * ------------------------------------------------------------------ */
export function CommentsActivity({
  taskId,
  members,
  canComment,
}: {
  taskId: string;
  members: Member[];
  canComment: boolean;
}) {
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activityLoaded = useRef(false);
  const me = getUser();

  const nameOf = (id: string): string | null =>
    members.find((m) => m.id === id)?.fullName ?? null;

  const loadComments = async (): Promise<void> => {
    try {
      const r = await commentsApi.list(taskId);
      const sorted = [...r.comments].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      setComments(sorted);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load comments.");
    }
  };

  const loadActivity = async (): Promise<void> => {
    try {
      const r = await commentsApi.activity(taskId);
      activityLoaded.current = true;
      setActivity(
        [...r.activity].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      );
    } catch {
      setActivity((prev) => prev ?? []);
    }
  };

  useEffect(() => {
    setComments(null);
    setActivity(null);
    activityLoaded.current = false;
    setError("");
    void loadComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Lazy-load the feed the first time the tab opens.
  useEffect(() => {
    if (tab === "activity" && !activityLoaded.current) void loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Live updates for THIS task.
  useRealtime(
    (e) => {
      if (e.type === "comment.changed" && e.payload.taskId === taskId) {
        void loadComments();
        if (activityLoaded.current) void loadActivity();
      }
      if (e.type === "task.changed" && e.payload.taskId === taskId) {
        if (activityLoaded.current) void loadActivity();
      }
    },
    [taskId],
  );

  /** Run a comment mutation, then refetch the thread. */
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await loadComments();
      if (activityLoaded.current) void loadActivity();
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const addComment = (body: string, assigneeUserId: string | null): void => {
    void run(() =>
      commentsApi.create(taskId, {
        body,
        ...(assigneeUserId ? { assigneeUserId } : {}),
      }),
    );
  };
  const addReply = (parent: TaskComment, body: string): void => {
    void run(() =>
      commentsApi.create(taskId, { body, parentCommentId: parent.id }),
    );
  };
  const saveEdit = (c: TaskComment, body: string): void => {
    if (body === c.body) return;
    void run(() => commentsApi.update(c.id, { body }));
  };
  const deleteComment = (c: TaskComment): void => {
    if (!window.confirm("Delete this comment?")) return;
    void run(() => commentsApi.remove(c.id));
  };
  const toggleResolve = (c: TaskComment): void => {
    void run(() => commentsApi.update(c.id, { resolved: c.resolvedAt === null }));
  };

  const commentCount = useMemo(() => {
    let n = 0;
    for (const c of comments ?? []) n += 1 + (c.replies?.length ?? 0);
    return n;
  }, [comments]);

  return (
    <section className="tp-section cm-section">
      <div className="cm-tabs" role="tablist" aria-label="Comments and activity">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "comments"}
          className={`cm-tab${tab === "comments" ? " on" : ""}`}
          onClick={() => setTab("comments")}
        >
          {Icons.chat} Comments
          {commentCount > 0 && <span className="tp-count-badge">{commentCount}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "activity"}
          className={`cm-tab${tab === "activity" ? " on" : ""}`}
          onClick={() => setTab("activity")}
        >
          {Icons.bolt} Activity
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {tab === "comments" ? (
        <>
          <div className="cm-thread">
            {comments === null ? (
              <>
                <span className="skel" style={{ width: "80%", height: 40, marginBottom: 8 }} />
                <span className="skel" style={{ width: "65%", height: 40 }} />
              </>
            ) : comments.length === 0 ? (
              <div className="tp-empty tp-empty-pad">
                No comments yet{canComment ? " — start the conversation." : "."}
              </div>
            ) : (
              comments.map((c) => (
                <CommentItem
                  key={c.id}
                  c={c}
                  isReply={false}
                  meId={me?.id ?? null}
                  members={members}
                  canComment={canComment}
                  busy={busy}
                  onReply={addReply}
                  onSaveEdit={saveEdit}
                  onDelete={deleteComment}
                  onToggleResolve={toggleResolve}
                />
              ))
            )}
          </div>
          {canComment && (
            <Composer
              members={members}
              placeholder="Write a comment… (@ to mention)"
              allowAssign
              busy={busy}
              onSubmit={addComment}
            />
          )}
        </>
      ) : (
        <div className="act-feed">
          {activity === null ? (
            <>
              <span className="skel" style={{ width: "90%", height: 22, marginBottom: 8 }} />
              <span className="skel" style={{ width: "70%", height: 22 }} />
            </>
          ) : activity.length === 0 ? (
            <div className="tp-empty tp-empty-pad">No activity recorded yet.</div>
          ) : (
            activity.map((a) => (
              <div className="act-row" key={a.id}>
                <span className={`act-ic act-${a.kind}`}>{KIND_ICON[a.kind] ?? Icons.bolt}</span>
                <span className="act-text">
                  <strong>{a.actor?.fullName ?? "Someone"}</strong>{" "}
                  {describeActivity(a, nameOf)}
                </span>
                <span className="act-time" title={new Date(a.createdAt).toLocaleString()}>
                  {timeAgo(a.createdAt)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
