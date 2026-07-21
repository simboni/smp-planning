"use client";

/**
 * ShareDialog — ClickUp-style "Sharing & permissions" for a Space.
 *
 * Opened from the space `⋯` menu in the sidebar tree and from a "Share"
 * button on the space page header. Given a spaceId it:
 *   - loads `GET /spaces/:id/access` (privacy + per-principal grants + a
 *     `canManage` flag that gates every mutation),
 *   - offers a Private / Public toggle,
 *   - lists the people and teams with access, each with a permission
 *     dropdown (View / Comment / Edit / Full) and a remove ✕,
 *   - lets you add workspace members or teams via a search picker.
 *
 * Every mutation refetches the dialog's own view of access and calls the
 * optional `onChanged` callback so the sidebar tree can reload (lock icons +
 * permission-gated actions stay in sync). All controls are read-only when
 * `canManage` is false.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  accessApi,
  teamsApi,
  workspacesApi,
  type AccessEntry,
  type Member,
  type Permission,
  type SpaceAccess,
  type Team,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";
import { Avatar } from "@/components/Avatar";

const PERMISSION_OPTS: { value: Permission; label: string }[] = [
  { value: "view", label: "View" },
  { value: "comment", label: "Comment" },
  { value: "edit", label: "Edit" },
  { value: "full", label: "Full" },
];

/** A pickable principal (workspace member or team) for the add search. */
type Candidate =
  | {
      kind: "user";
      id: string;
      name: string;
      email: string;
      isGuest: boolean;
    }
  | { kind: "team"; id: string; name: string; color: string; memberCount: number };

export function ShareDialog({
  spaceId,
  spaceName,
  onClose,
  onChanged,
}: {
  spaceId: string;
  spaceName?: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [access, setAccess] = useState<SpaceAccess | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Add-picker state.
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addPermission, setAddPermission] = useState<Permission>("edit");
  const pickerRef = useRef<HTMLDivElement>(null);

  const canManage = access?.canManage ?? false;

  const loadAccess = async (): Promise<void> => {
    try {
      const a = await accessApi.getSpaceAccess(spaceId);
      setAccess(a);
      setError("");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't load sharing settings.",
      );
    }
  };

  useEffect(() => {
    void loadAccess();
    // Members + teams feed the picker; failures are non-fatal.
    workspacesApi
      .members()
      .then((r) => setMembers(r.members))
      .catch(() => undefined);
    teamsApi
      .list()
      .then((r) => setTeams(r.teams))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  // Esc closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Click-away closes the picker dropdown.
  useEffect(() => {
    if (!pickerOpen) return;
    const close = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [pickerOpen]);

  const entries = access?.entries ?? [];

  // Which principals already have access — excluded from the picker.
  const takenUsers = useMemo(
    () =>
      new Set(
        entries.filter((e) => e.principalType === "user").map((e) => e.principalId),
      ),
    [entries],
  );
  const takenTeams = useMemo(
    () =>
      new Set(
        entries.filter((e) => e.principalType === "team").map((e) => e.principalId),
      ),
    [entries],
  );

  const candidates = useMemo<Candidate[]>(() => {
    const needle = query.trim().toLowerCase();
    const userCands: Candidate[] = members
      .filter((m) => !takenUsers.has(m.id))
      .map((m) => ({
        kind: "user" as const,
        id: m.id,
        name: m.fullName || m.email,
        email: m.email,
        isGuest: m.role === "guest",
      }));
    const teamCands: Candidate[] = teams
      .filter((t) => !takenTeams.has(t.id))
      .map((t) => ({
        kind: "team" as const,
        id: t.id,
        name: t.name,
        color: t.color,
        memberCount: t.memberCount,
      }));
    const all = [...teamCands, ...userCands];
    if (!needle) return all;
    return all.filter((c) => {
      const hay =
        c.kind === "user" ? `${c.name} ${c.email}` : c.name;
      return hay.toLowerCase().includes(needle);
    });
  }, [members, teams, takenUsers, takenTeams, query]);

  /* -- mutations ----------------------------------------------------- */
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await loadAccess();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const togglePrivacy = (isPrivate: boolean): void => {
    if (!canManage) return;
    void run(() => accessApi.setPrivacy(spaceId, isPrivate));
  };

  const changePermission = (entry: AccessEntry, permission: Permission): void => {
    if (!canManage || permission === entry.permission) return;
    void run(() =>
      accessApi.upsertShare(spaceId, {
        principalType: entry.principalType,
        principalId: entry.principalId,
        permission,
      }),
    );
  };

  const removeEntry = (entry: AccessEntry): void => {
    if (!canManage) return;
    void run(() =>
      accessApi.removeShare(spaceId, entry.principalType, entry.principalId),
    );
  };

  const addCandidate = (c: Candidate): void => {
    if (!canManage) return;
    setQuery("");
    setPickerOpen(false);
    void run(() =>
      accessApi.upsertShare(spaceId, {
        principalType: c.kind,
        principalId: c.id,
        permission: addPermission,
      }),
    );
  };

  /* -- render -------------------------------------------------------- */
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal share"
        role="dialog"
        aria-modal="true"
        aria-label="Sharing and permissions"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.share}</span>
            <div>
              <h2>Share {spaceName ? `“${spaceName}”` : "space"}</h2>
              <p className="muted share-sub">
                Control who can see and work in this space.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            {Icons.close}
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          {access === null ? (
            <div className="share-loading">
              <span className="skel" style={{ width: "100%", height: 54, marginBottom: 10 }} />
              <span className="skel" style={{ width: "100%", height: 44, marginBottom: 8 }} />
              <span className="skel" style={{ width: "100%", height: 44 }} />
            </div>
          ) : (
            <>
              {/* Privacy toggle */}
              <div className="share-privacy">
                <button
                  type="button"
                  className={`share-priv-opt${!access.isPrivate ? " active" : ""}`}
                  disabled={!canManage || busy}
                  onClick={() => togglePrivacy(false)}
                >
                  <span className="share-priv-ic">{Icons.globe}</span>
                  <span className="share-priv-text">
                    <span className="share-priv-title">Public</span>
                    <span className="share-priv-sub">Everyone in the workspace</span>
                  </span>
                  {!access.isPrivate && <span className="share-priv-check">{Icons.check}</span>}
                </button>
                <button
                  type="button"
                  className={`share-priv-opt${access.isPrivate ? " active" : ""}`}
                  disabled={!canManage || busy}
                  onClick={() => togglePrivacy(true)}
                >
                  <span className="share-priv-ic">{Icons.lock}</span>
                  <span className="share-priv-text">
                    <span className="share-priv-title">Private</span>
                    <span className="share-priv-sub">Only people with access</span>
                  </span>
                  {access.isPrivate && <span className="share-priv-check">{Icons.check}</span>}
                </button>
              </div>

              {/* Add people or teams */}
              {canManage && (
                <div className="share-add" ref={pickerRef}>
                  <div className="share-add-row">
                    <div className="share-add-input">
                      {Icons.plus}
                      <input
                        className="share-add-field"
                        placeholder="Add people or teams…"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setPickerOpen(true);
                        }}
                        onFocus={() => setPickerOpen(true)}
                      />
                    </div>
                    <select
                      className="input share-add-perm"
                      value={addPermission}
                      onChange={(e) => setAddPermission(e.target.value as Permission)}
                      aria-label="Permission for new people"
                    >
                      {PERMISSION_OPTS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {pickerOpen && (
                    <div className="share-picker">
                      {candidates.length === 0 ? (
                        <div className="share-picker-empty">
                          {query.trim()
                            ? `No people or teams match “${query.trim()}”.`
                            : "Everyone already has access."}
                        </div>
                      ) : (
                        candidates.slice(0, 8).map((c) => (
                          <button
                            key={`${c.kind}:${c.id}`}
                            type="button"
                            className="share-picker-hit"
                            onClick={() => addCandidate(c)}
                            disabled={busy}
                          >
                            {c.kind === "team" ? (
                              <span
                                className="share-team-dot"
                                style={{ background: c.color || colorFor(c.id) }}
                              >
                                {Icons.team}
                              </span>
                            ) : (
                              <Avatar
                                name={c.name}
                                id={c.id}
                                avatarUrl={undefined}
                                className="avatar-sm"
                              />
                            )}
                            <span className="share-picker-body">
                              <span className="share-picker-name">
                                {c.name}
                                {c.kind === "user" && c.isGuest && (
                                  <span className="badge role-guest share-guest-tag">Guest</span>
                                )}
                                {c.kind === "team" && (
                                  <span className="badge badge-soft share-team-tag">Team</span>
                                )}
                              </span>
                              <span className="share-picker-sub">
                                {c.kind === "user"
                                  ? c.email
                                  : `${c.memberCount} ${c.memberCount === 1 ? "member" : "members"}`}
                              </span>
                            </span>
                            <span className="share-picker-add">{Icons.plus}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Access list */}
              <div className="share-list-title">People &amp; teams with access</div>
              <div className="share-list">
                {entries.length === 0 ? (
                  <div className="share-empty">
                    {access.isPrivate
                      ? "No one has been given access yet."
                      : "Everyone in the workspace can access this space."}
                  </div>
                ) : (
                  entries.map((entry) => (
                    <div
                      key={`${entry.principalType}:${entry.principalId}`}
                      className="share-entry"
                    >
                      {entry.principalType === "team" ? (
                        <span
                          className="share-team-dot"
                          style={{ background: colorFor(entry.principalId) }}
                        >
                          {Icons.team}
                        </span>
                      ) : (
                        <Avatar
                          name={entry.name}
                          id={entry.principalId}
                          avatarUrl={entry.avatarUrl}
                          className="avatar-sm"
                        />
                      )}
                      <span className="share-entry-body">
                        <span className="share-entry-name">
                          {entry.name}
                          {entry.principalType === "team" && (
                            <span className="badge badge-soft share-team-tag">Team</span>
                          )}
                        </span>
                        <span className="share-entry-sub">
                          {entry.principalType === "user"
                            ? entry.email ?? ""
                            : "Team"}
                        </span>
                      </span>

                      {canManage ? (
                        <select
                          className="input share-entry-perm"
                          value={entry.permission}
                          disabled={busy}
                          onChange={(e) =>
                            changePermission(entry, e.target.value as Permission)
                          }
                          aria-label={`Permission for ${entry.name}`}
                        >
                          {PERMISSION_OPTS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="badge share-entry-ro">
                          {PERMISSION_OPTS.find((o) => o.value === entry.permission)?.label}
                        </span>
                      )}

                      {canManage && (
                        <button
                          type="button"
                          className="icon-btn share-remove"
                          aria-label={`Remove ${entry.name}`}
                          title="Remove access"
                          disabled={busy}
                          onClick={() => removeEntry(entry)}
                        >
                          {Icons.close}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>

              {!canManage && (
                <div className="notice share-ro-notice">
                  {Icons.info}
                  You have view access to these settings. Only members with full
                  access can change sharing.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
