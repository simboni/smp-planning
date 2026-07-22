"use client";

/**
 * Module 13 — Chat. `/chat?c=<channelId>` (static export: no [id] routes).
 *
 * A Slack-like three-pane workspace:
 *   • LEFT rail — Channels (# name + unread, ＋create, Browse public) and
 *     Direct messages (＋member-picker → find-or-create DM).
 *   • CENTER — channel header (name, member count, Start/Join SyncUp),
 *     a grouped message list (author runs, avatars, @mention chips, edited
 *     markers, hover react / reply / edit / delete, reaction pills), and a
 *     composer (@ picker inserts `@[userId]`, Enter sends / Shift+Enter
 *     newline). Older messages load on scroll-up; live via `chat.message`.
 *   • RIGHT — a thread pane opened from "N replies".
 *
 * SyncUp is a lightweight "we're talking now" presence: a slim banner plus a
 * participants modal (audio is a future pass).
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  chatApi,
  getUser,
  workspacesApi,
  type Channel,
  type ChatMessage,
  type Member,
  type PublicChannel,
  type Syncup,
} from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { renderMentions } from "@/components/CommentsActivity";
import { Icons } from "@/components/icons";
import { formatDateTime, timeAgo } from "@/lib/format";
import { Avatar } from "@/components/Avatar";

const REACTION_EMOJI = ["👍", "❤️", "😄", "🎉", "🙌", "👀", "🚀", "✅"];

/** Are two messages close enough in time to belong to one author "run"? */
function sameRun(a: ChatMessage, b: ChatMessage): boolean {
  if (a.author.id !== b.author.id) return false;
  const gap = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return gap >= 0 && gap < 5 * 60 * 1000;
}

/** A short wall-clock time label (e.g. "3:42 PM"). */
function clockTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ *
 * @-mention picker — a small popover that inserts `@[userId]` tokens.
 * ------------------------------------------------------------------ */
function MentionPicker({
  members,
  onPick,
  onClose,
}: {
  members: Member[];
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
    <div className="chat-mention-pop" ref={ref}>
      <div className="chat-mention-search">
        {Icons.atSign}
        <input
          autoFocus
          className="chat-mention-input"
          placeholder="Mention someone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="chat-mention-list">
        {hits.length === 0 ? (
          <div className="chat-mention-empty">No people match.</div>
        ) : (
          hits.slice(0, 8).map((m) => (
            <button
              key={m.id}
              type="button"
              className="chat-mention-row"
              onClick={() => onPick(m)}
            >
              <Avatar
                name={m.fullName || m.email}
                id={m.id}
                avatarUrl={m.avatarUrl}
                className="avatar-sm"
              />
              <span className="chat-mention-name">{m.fullName || m.email}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Composer — textarea, @ picker, Enter to send.
 * ------------------------------------------------------------------ */
function Composer({
  members,
  placeholder,
  onSend,
  autoFocus,
}: {
  members: Member[];
  placeholder: string;
  onSend: (body: string) => Promise<void>;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const insertMention = (m: Member): void => {
    const el = ref.current;
    const token = `@[${m.id}] `;
    if (el) {
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      // If the user just typed a trigger "@", swallow it.
      const before =
        start > 0 && value[start - 1] === "@" ? value.slice(0, start - 1) : value.slice(0, start);
      const next = `${before}${token}${value.slice(end)}`;
      setValue(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = before.length + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      setValue((v) => `${v}${token}`);
    }
    setPickerOpen(false);
  };

  const submit = async (): Promise<void> => {
    const body = value.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setValue("");
      ref.current?.focus();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chat-composer">
      {pickerOpen && (
        <MentionPicker
          members={members}
          onPick={insertMention}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <textarea
        ref={ref}
        className="chat-composer-input"
        placeholder={placeholder}
        rows={1}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          const el = e.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "@") {
            setPickerOpen(true);
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="chat-composer-tools">
        <button
          type="button"
          className="icon-btn"
          title="Mention someone"
          onClick={() => setPickerOpen((v) => !v)}
        >
          {Icons.atSign}
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!value.trim() || sending}
          onClick={() => void submit()}
        >
          {Icons.send} Send
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A single message row (used in the main list and thread pane).
 * ------------------------------------------------------------------ */
function MessageRow({
  msg,
  showHeader,
  meId,
  nameOf,
  onReact,
  onReply,
  onEdit,
  onDelete,
  hideReplies,
}: {
  msg: ChatMessage;
  showHeader: boolean;
  meId: string | null;
  nameOf: (userId: string) => string | null;
  onReact: (emoji: string) => void;
  onReply?: () => void;
  onEdit: (body: string) => void;
  onDelete: () => void;
  hideReplies?: boolean;
}) {
  const [popOpen, setPopOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.body);
  const mine = meId != null && msg.author.id === meId;

  const saveEdit = (): void => {
    const body = draft.trim();
    if (body && body !== msg.body) onEdit(body);
    setEditing(false);
  };

  return (
    <div className={`chat-msg${showHeader ? " has-header" : ""}`}>
      <div className="chat-msg-gutter">
        {showHeader ? (
          <Avatar
            name={msg.author.fullName}
            id={msg.author.id}
            avatarUrl={msg.author.avatarUrl}
          />
        ) : (
          <span className="chat-msg-time-hover">{clockTime(msg.createdAt)}</span>
        )}
      </div>

      <div className="chat-msg-body">
        {showHeader && (
          <div className="chat-msg-head">
            <span className="chat-msg-author">{msg.author.fullName}</span>
            <span className="chat-msg-time">{clockTime(msg.createdAt)}</span>
          </div>
        )}

        {editing ? (
          <div className="chat-msg-edit">
            <textarea
              className="chat-composer-input"
              value={draft}
              autoFocus
              rows={2}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(msg.body);
                }
              }}
            />
            <div className="chat-msg-edit-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setDraft(msg.body); }}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={saveEdit}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="chat-msg-text">
            {renderMentions(msg.body, nameOf)}
            {msg.editedAt && <span className="chat-msg-edited"> (edited)</span>}
          </div>
        )}

        {msg.reactions.length > 0 && (
          <div className="chat-reactions">
            {msg.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={`chat-reaction${r.mine ? " mine" : ""}`}
                onClick={() => onReact(r.emoji)}
                title={r.mine ? "Remove your reaction" : "Add reaction"}
              >
                <span className="chat-reaction-emoji">{r.emoji}</span>
                <span className="chat-reaction-count">{r.count}</span>
              </button>
            ))}
            <button
              type="button"
              className="chat-reaction chat-reaction-add"
              title="Add reaction"
              onClick={() => setPopOpen((v) => !v)}
            >
              {Icons.smile}
            </button>
          </div>
        )}

        {!hideReplies && msg.replyCount > 0 && onReply && (
          <button type="button" className="chat-thread-link" onClick={onReply}>
            {Icons.chat} {msg.replyCount} {msg.replyCount === 1 ? "reply" : "replies"}
          </button>
        )}
      </div>

      {/* hover actions */}
      {!editing && (
        <div className="chat-msg-actions">
          <button
            type="button"
            className="icon-btn"
            title="React"
            onClick={() => setPopOpen((v) => !v)}
          >
            {Icons.smile}
          </button>
          {onReply && (
            <button type="button" className="icon-btn" title="Reply in thread" onClick={onReply}>
              {Icons.chat}
            </button>
          )}
          {mine && (
            <>
              <button type="button" className="icon-btn" title="Edit" onClick={() => { setDraft(msg.body); setEditing(true); }}>
                {Icons.edit}
              </button>
              <button type="button" className="icon-btn" title="Delete" onClick={onDelete}>
                {Icons.trash}
              </button>
            </>
          )}
          {popOpen && (
            <div className="chat-emoji-pop" onMouseLeave={() => setPopOpen(false)}>
              {REACTION_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="chat-emoji-btn"
                  onClick={() => {
                    onReact(e);
                    setPopOpen(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Create-channel modal.
 * ------------------------------------------------------------------ */
function CreateChannelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: Channel) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async (): Promise<void> => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await chatApi.create({ name: n, description: description.trim() || undefined });
      onCreated(r.channel);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create channel.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Create a channel</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          <label className="field-label">Name</label>
          <div className="chat-name-field">
            <span className="chat-name-hash">{Icons.hash}</span>
            <input
              autoFocus
              className="input"
              placeholder="e.g. marketing"
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\s+/g, "-").toLowerCase())}
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
          </div>
          <label className="field-label" style={{ marginTop: 12 }}>
            Description <span className="field-optional">(optional)</span>
          </label>
          <textarea
            className="input"
            rows={2}
            placeholder="What's this channel about?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void create()}>
              Create channel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Browse public channels modal.
 * ------------------------------------------------------------------ */
function BrowseModal({
  onClose,
  onJoined,
}: {
  onClose: () => void;
  onJoined: (channelId: string) => void;
}) {
  const [channels, setChannels] = useState<PublicChannel[] | null>(null);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await chatApi.listPublic();
      setChannels(r.channels);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load channels.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const join = async (c: PublicChannel): Promise<void> => {
    setJoining(c.id);
    try {
      await chatApi.join(c.id);
      onJoined(c.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't join channel.");
      setJoining(null);
    }
  };

  const needle = q.trim().toLowerCase();
  const hits = (channels ?? []).filter((c) =>
    !needle ? true : `${c.name} ${c.description ?? ""}`.toLowerCase().includes(needle),
  );

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Browse channels</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          <div className="chat-browse-search">
            {Icons.search}
            <input
              autoFocus
              className="input"
              placeholder="Search channels…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="chat-browse-list">
            {channels === null ? (
              <>
                <span className="skel" style={{ height: 56 }} />
                <span className="skel" style={{ height: 56 }} />
              </>
            ) : hits.length === 0 ? (
              <div className="tp-empty tp-empty-pad">No public channels.</div>
            ) : (
              hits.map((c) => (
                <div key={c.id} className="chat-browse-row">
                  <span className="chat-browse-hash">{Icons.hash}</span>
                  <div className="chat-browse-meta">
                    <span className="chat-browse-name">{c.name}</span>
                    <span className="chat-browse-desc">
                      {c.description || "No description"} · {c.memberCount}{" "}
                      {c.memberCount === 1 ? "member" : "members"}
                    </span>
                  </div>
                  {c.joined ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onJoined(c.id)}>
                      Open
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-soft btn-sm"
                      disabled={joining === c.id}
                      onClick={() => void join(c)}
                    >
                      {joining === c.id ? "Joining…" : "Join"}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * DM member-picker modal.
 * ------------------------------------------------------------------ */
function DmPickerModal({
  members,
  meId,
  onClose,
  onOpened,
}: {
  members: Member[];
  meId: string | null;
  onClose: () => void;
  onOpened: (channelId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const open = async (m: Member): Promise<void> => {
    setBusy(m.id);
    try {
      const r = await chatApi.openDm(m.id);
      onOpened(r.channel.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't open DM.");
      setBusy(null);
    }
  };

  const needle = q.trim().toLowerCase();
  const hits = members
    .filter((m) => m.id !== meId)
    .filter((m) => (!needle ? true : `${m.fullName} ${m.email}`.toLowerCase().includes(needle)));

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>New direct message</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          <div className="chat-browse-search">
            {Icons.search}
            <input
              autoFocus
              className="input"
              placeholder="Search people…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="chat-browse-list">
            {hits.length === 0 ? (
              <div className="tp-empty tp-empty-pad">No people match.</div>
            ) : (
              hits.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="chat-dm-pick"
                  disabled={busy === m.id}
                  onClick={() => void open(m)}
                >
                  <Avatar
                    name={m.fullName || m.email}
                    id={m.id}
                    avatarUrl={m.avatarUrl}
                  />
                  <div className="chat-dm-pick-meta">
                    <span className="chat-dm-pick-name">{m.fullName || m.email}</span>
                    <span className="chat-dm-pick-email">{m.email}</span>
                  </div>
                  {busy === m.id && <span className="spinner" style={{ width: 15, height: 15 }} />}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * SyncUp modal.
 * ------------------------------------------------------------------ */
function SyncupModal({
  syncup,
  channel,
  isStarter,
  onEnd,
  onClose,
}: {
  syncup: Syncup;
  channel: Channel | null;
  isStarter: boolean;
  onEnd: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal chat-syncup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🔊 SyncUp</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          <div className="chat-syncup-audio">
            {Icons.phone}
            <span>Audio coming soon — this is a lightweight presence for now.</span>
          </div>
          <div className="chat-syncup-started">
            Started by <strong>{syncup.startedBy.fullName}</strong> · {timeAgo(syncup.startedAt)}
          </div>
          <div className="field-label" style={{ marginTop: 8 }}>
            Participants
          </div>
          <div className="chat-syncup-parts">
            {(channel?.members ?? [syncup.startedBy]).map((u) => (
              <div key={u.id} className="chat-syncup-part">
                <Avatar
                  name={u.fullName}
                  id={u.id}
                  avatarUrl={u.avatarUrl}
                  className="avatar-sm"
                />
                <span>{u.fullName}</span>
              </div>
            ))}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Leave
            </button>
            {isStarter && (
              <button type="button" className="btn btn-danger" onClick={onEnd}>
                End SyncUp
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== *
 * Main view.
 * ================================================================== */
function ChatView() {
  const router = useRouter();
  const search = useSearchParams();
  const activeId = search.get("c");

  const me = useMemo(() => getUser(), []);
  const meId = me?.id ?? null;

  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [syncup, setSyncup] = useState<Syncup | null>(null);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadParent, setThreadParent] = useState<ChatMessage | null>(null);
  const [threadReplies, setThreadReplies] = useState<ChatMessage[] | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const [showDm, setShowDm] = useState(false);
  const [showSyncup, setShowSyncup] = useState(false);
  const [error, setError] = useState("");

  const listRef = useRef<HTMLDivElement>(null);
  const pinBottom = useRef(true);

  const activeChannel = useMemo(
    () => channels?.find((c) => c.id === activeId) ?? null,
    [channels, activeId],
  );

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.id, m.fullName || m.email);
    return map;
  }, [members]);
  const nameOf = useCallback((id: string): string | null => nameById.get(id) ?? null, [nameById]);

  /* ---- data loaders ---- */
  const loadChannels = useCallback(async (): Promise<void> => {
    try {
      const r = await chatApi.list();
      setChannels(r.channels);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load channels.");
    }
  }, []);

  useEffect(() => {
    void loadChannels();
    workspacesApi
      .members()
      .then((r) => setMembers(r.members ?? []))
      .catch(() => undefined);
  }, [loadChannels]);

  // If no channel is selected, land on the first one.
  useEffect(() => {
    if (!activeId && channels && channels.length > 0) {
      router.replace(`/chat?c=${channels[0].id}`);
    }
  }, [activeId, channels, router]);

  const loadMessages = useCallback(async (channelId: string): Promise<void> => {
    setMessages(null);
    setHasMore(false);
    try {
      const r = await chatApi.messages(channelId, { limit: 50 });
      // API is newest-first; render oldest-first.
      setMessages([...r.messages].reverse());
      setHasMore(r.messages.length >= 50);
      pinBottom.current = true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load messages.");
      setMessages([]);
    }
  }, []);

  const loadSyncup = useCallback(async (channelId: string): Promise<void> => {
    try {
      const r = await chatApi.getSyncup(channelId);
      setSyncup(r.active);
    } catch {
      setSyncup(null);
    }
  }, []);

  // On channel change: load messages + syncup, mark read, close any thread.
  useEffect(() => {
    if (!activeId) {
      setMessages(null);
      return;
    }
    setThreadId(null);
    void loadMessages(activeId);
    void loadSyncup(activeId);
    chatApi
      .markRead(activeId)
      .then(() => loadChannels())
      .catch(() => undefined);
  }, [activeId, loadMessages, loadSyncup, loadChannels]);

  // Keep the list pinned to the bottom after new messages arrive.
  useEffect(() => {
    if (pinBottom.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const loadOlder = useCallback(async (): Promise<void> => {
    if (!activeId || loadingOlder || !hasMore || !messages || messages.length === 0) return;
    setLoadingOlder(true);
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const r = await chatApi.messages(activeId, {
        before: messages[0].createdAt,
        limit: 50,
      });
      if (r.messages.length === 0) {
        setHasMore(false);
      } else {
        pinBottom.current = false;
        setMessages((prev) => [...[...r.messages].reverse(), ...(prev ?? [])]);
        setHasMore(r.messages.length >= 50);
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight;
        });
      }
    } catch {
      /* leave as-is */
    } finally {
      setLoadingOlder(false);
    }
  }, [activeId, loadingOlder, hasMore, messages]);

  const onScroll = (): void => {
    const el = listRef.current;
    if (!el) return;
    pinBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && hasMore && !loadingOlder) void loadOlder();
  };

  /* ---- thread pane ---- */
  const loadThread = useCallback(async (messageId: string): Promise<void> => {
    setThreadReplies(null);
    try {
      const r = await chatApi.thread(messageId);
      setThreadParent(r.parent);
      setThreadReplies(r.replies);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load thread.");
    }
  }, []);

  useEffect(() => {
    if (threadId) void loadThread(threadId);
  }, [threadId, loadThread]);

  /* ---- realtime ---- */
  useRealtime(
    (e) => {
      if (e.type !== "chat.message") return;
      if (e.payload.channelId === activeId) {
        void chatApi.messages(activeId, { limit: 50 }).then((r) => {
          setMessages([...r.messages].reverse());
        });
        if (threadId) void loadThread(threadId);
        chatApi.markRead(activeId).catch(() => undefined);
      }
      void loadChannels();
    },
    [activeId, threadId, loadThread, loadChannels],
  );

  /* ---- mutations ---- */
  const sendMessage = async (body: string): Promise<void> => {
    if (!activeId) return;
    pinBottom.current = true;
    await chatApi.send(activeId, { body });
    await loadMessages(activeId);
    void loadChannels();
  };

  const sendReply = async (body: string): Promise<void> => {
    if (!activeId || !threadId) return;
    await chatApi.send(activeId, { body, parentMessageId: threadId });
    await loadThread(threadId);
    await loadMessages(activeId);
  };

  const react = async (messageId: string, emoji: string, inThread: boolean): Promise<void> => {
    try {
      const r = await chatApi.react(messageId, emoji);
      const apply = (m: ChatMessage): ChatMessage =>
        m.id === messageId ? { ...m, reactions: r.reactions } : m;
      setMessages((prev) => (prev ? prev.map(apply) : prev));
      if (inThread) {
        setThreadReplies((prev) => (prev ? prev.map(apply) : prev));
        setThreadParent((prev) => (prev && prev.id === messageId ? { ...prev, reactions: r.reactions } : prev));
      }
    } catch {
      /* ignore */
    }
  };

  const editMessage = async (messageId: string, body: string): Promise<void> => {
    try {
      await chatApi.edit(messageId, { body });
      if (activeId) await loadMessages(activeId);
      if (threadId) await loadThread(threadId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't edit message.");
    }
  };

  const deleteMessage = async (messageId: string): Promise<void> => {
    if (typeof window !== "undefined" && !window.confirm("Delete this message?")) return;
    try {
      await chatApi.remove(messageId);
      if (activeId) await loadMessages(activeId);
      if (threadId === messageId) setThreadId(null);
      else if (threadId) await loadThread(threadId);
      void loadChannels();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete message.");
    }
  };

  /* ---- syncup ---- */
  const startSyncup = async (): Promise<void> => {
    if (!activeId) return;
    try {
      const r = await chatApi.startSyncup(activeId);
      setSyncup(r.syncup);
      setShowSyncup(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start SyncUp.");
    }
  };

  const endSyncup = async (): Promise<void> => {
    if (!syncup) return;
    try {
      await chatApi.endSyncup(syncup.id);
      setSyncup(null);
      setShowSyncup(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't end SyncUp.");
    }
  };

  /* ---- rail split ---- */
  const roomChannels = (channels ?? []).filter((c) => !c.isDm);
  const dmChannels = (channels ?? []).filter((c) => c.isDm);

  const goChannel = (id: string): void => router.push(`/chat?c=${id}`);

  return (
    <div className="chat-shell">
      {/* LEFT rail */}
      <aside className="chat-rail">
        <div className="chat-rail-head">
          <span className="chat-rail-title">{Icons.chat} Chat</span>
        </div>

        <div className="chat-rail-scroll">
          <div className="chat-rail-section">
            <div className="chat-rail-section-head">
              <span>Channels</span>
              <div className="chat-rail-section-actions">
                <button type="button" className="icon-btn" title="Browse channels" onClick={() => setShowBrowse(true)}>
                  {Icons.search}
                </button>
                <button type="button" className="icon-btn" title="Create channel" onClick={() => setShowCreate(true)}>
                  {Icons.plus}
                </button>
              </div>
            </div>
            {channels === null ? (
              <>
                <span className="skel" style={{ height: 30, margin: "3px 0" }} />
                <span className="skel" style={{ height: 30, margin: "3px 0" }} />
              </>
            ) : roomChannels.length === 0 ? (
              <button type="button" className="chat-rail-empty" onClick={() => setShowBrowse(true)}>
                Browse channels to join →
              </button>
            ) : (
              roomChannels.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chat-rail-item${c.id === activeId ? " active" : ""}${c.unread > 0 ? " unread" : ""}`}
                  onClick={() => goChannel(c.id)}
                >
                  <span className="chat-rail-hash">{Icons.hash}</span>
                  <span className="chat-rail-name">{c.name}</span>
                  {c.unread > 0 && <span className="chat-rail-badge">{c.unread > 99 ? "99+" : c.unread}</span>}
                </button>
              ))
            )}
          </div>

          <div className="chat-rail-section">
            <div className="chat-rail-section-head">
              <span>Direct messages</span>
              <div className="chat-rail-section-actions">
                <button type="button" className="icon-btn" title="New message" onClick={() => setShowDm(true)}>
                  {Icons.plus}
                </button>
              </div>
            </div>
            {dmChannels.length === 0 ? (
              <button type="button" className="chat-rail-empty" onClick={() => setShowDm(true)}>
                Start a direct message →
              </button>
            ) : (
              dmChannels.map((c) => {
                const other = c.members.find((m) => m.id !== meId) ?? c.members[0];
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`chat-rail-item${c.id === activeId ? " active" : ""}${c.unread > 0 ? " unread" : ""}`}
                    onClick={() => goChannel(c.id)}
                  >
                    <Avatar
                      name={other?.fullName ?? c.name}
                      id={other?.id ?? c.id}
                      avatarUrl={other?.avatarUrl}
                      className="avatar-sm"
                    />
                    <span className="chat-rail-name">{other?.fullName ?? c.name}</span>
                    {c.unread > 0 && <span className="chat-rail-badge">{c.unread > 99 ? "99+" : c.unread}</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </aside>

      {/* CENTER */}
      <section className="chat-main">
        {!activeChannel ? (
          <div className="chat-empty-center">
            {channels && channels.length === 0 ? (
              <>
                <span className="chat-empty-icon">{Icons.chat}</span>
                <p>No channels yet. Create one to get the conversation going.</p>
                <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
                  {Icons.plus} Create a channel
                </button>
              </>
            ) : (
              <span className="spinner" />
            )}
          </div>
        ) : (
          <>
            <header className="chat-header">
              <div className="chat-header-title">
                {activeChannel.isDm ? (
                  <span className="chat-header-name">
                    {activeChannel.members.find((m) => m.id !== meId)?.fullName ?? activeChannel.name}
                  </span>
                ) : (
                  <span className="chat-header-name">
                    <span className="chat-header-hash">{Icons.hash}</span>
                    {activeChannel.name}
                  </span>
                )}
                <span className="chat-header-count">
                  {Icons.members} {activeChannel.memberCount}
                </span>
              </div>
              <span style={{ flex: 1 }} />
              {syncup ? (
                <button type="button" className="btn btn-soft btn-sm" onClick={() => setShowSyncup(true)}>
                  {Icons.phone} Join SyncUp
                </button>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void startSyncup()}>
                  {Icons.phone} Start SyncUp
                </button>
              )}
            </header>

            {syncup && (
              <div className="chat-syncup-banner" onClick={() => setShowSyncup(true)}>
                <span>🔊 SyncUp in progress — started by {syncup.startedBy.fullName}</span>
                <span style={{ flex: 1 }} />
                <span className="chat-syncup-join">Join →</span>
              </div>
            )}

            {error && <div className="form-error" style={{ margin: "8px 16px" }}>{error}</div>}

            <div className="chat-list" ref={listRef} onScroll={onScroll}>
              {loadingOlder && <div className="chat-list-loading"><span className="spinner" style={{ width: 16, height: 16 }} /></div>}
              {messages === null ? (
                <div className="chat-list-loading"><span className="spinner" /></div>
              ) : messages.length === 0 ? (
                <div className="chat-empty-center">
                  <span className="chat-empty-icon">{Icons.chat}</span>
                  <p>This is the very beginning of the conversation.</p>
                </div>
              ) : (
                messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const showHeader = !prev || !sameRun(prev, m);
                  return (
                    <MessageRow
                      key={m.id}
                      msg={m}
                      showHeader={showHeader}
                      meId={meId}
                      nameOf={nameOf}
                      onReact={(emoji) => void react(m.id, emoji, false)}
                      onReply={() => setThreadId(m.id)}
                      onEdit={(body) => void editMessage(m.id, body)}
                      onDelete={() => void deleteMessage(m.id)}
                    />
                  );
                })
              )}
            </div>

            <Composer
              members={members}
              placeholder={
                activeChannel.isDm
                  ? `Message ${activeChannel.members.find((m) => m.id !== meId)?.fullName ?? ""}`
                  : `Message #${activeChannel.name}`
              }
              onSend={sendMessage}
            />
          </>
        )}
      </section>

      {/* RIGHT thread pane */}
      {threadId && (
        <aside className="chat-thread">
          <div className="chat-thread-head">
            <span className="chat-thread-title">Thread</span>
            <button type="button" className="icon-btn" onClick={() => setThreadId(null)}>
              {Icons.close}
            </button>
          </div>
          <div className="chat-thread-scroll">
            {threadReplies === null ? (
              <div className="chat-list-loading"><span className="spinner" /></div>
            ) : (
              <>
                {threadParent && (
                  <MessageRow
                    msg={threadParent}
                    showHeader
                    meId={meId}
                    nameOf={nameOf}
                    hideReplies
                    onReact={(emoji) => void react(threadParent.id, emoji, true)}
                    onEdit={(body) => void editMessage(threadParent.id, body)}
                    onDelete={() => void deleteMessage(threadParent.id)}
                  />
                )}
                <div className="chat-thread-divider">
                  {threadReplies.length} {threadReplies.length === 1 ? "reply" : "replies"}
                </div>
                {threadReplies.map((r, i) => {
                  const prev = threadReplies[i - 1];
                  const showHeader = !prev || !sameRun(prev, r);
                  return (
                    <MessageRow
                      key={r.id}
                      msg={r}
                      showHeader={showHeader}
                      meId={meId}
                      nameOf={nameOf}
                      hideReplies
                      onReact={(emoji) => void react(r.id, emoji, true)}
                      onEdit={(body) => void editMessage(r.id, body)}
                      onDelete={() => void deleteMessage(r.id)}
                    />
                  );
                })}
              </>
            )}
          </div>
          <Composer members={members} placeholder="Reply…" onSend={sendReply} autoFocus />
        </aside>
      )}

      {/* modals */}
      {showCreate && (
        <CreateChannelModal
          onClose={() => setShowCreate(false)}
          onCreated={(c) => {
            setShowCreate(false);
            void loadChannels();
            goChannel(c.id);
          }}
        />
      )}
      {showBrowse && (
        <BrowseModal
          onClose={() => setShowBrowse(false)}
          onJoined={(id) => {
            setShowBrowse(false);
            void loadChannels();
            goChannel(id);
          }}
        />
      )}
      {showDm && (
        <DmPickerModal
          members={members}
          meId={meId}
          onClose={() => setShowDm(false)}
          onOpened={(id) => {
            setShowDm(false);
            void loadChannels();
            goChannel(id);
          }}
        />
      )}
      {showSyncup && syncup && (
        <SyncupModal
          syncup={syncup}
          channel={activeChannel}
          isStarter={syncup.startedBy.id === meId}
          onEnd={() => void endSyncup()}
          onClose={() => setShowSyncup(false)}
        />
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="chat-shell">
          <aside className="chat-rail" />
          <section className="chat-main">
            <div className="chat-list-loading"><span className="spinner" /></div>
          </section>
        </div>
      }
    >
      <ChatView />
    </Suspense>
  );
}
