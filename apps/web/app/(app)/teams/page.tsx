"use client";

/**
 * Teams — named groups of workspace members that can be shared onto Spaces
 * as a single principal (Module 2).
 *
 * Owners/admins get full management: create teams, rename, recolor, add and
 * remove members, delete. Plain members and guests see a read-only roster.
 * A team's member list is fetched lazily when its manage panel opens.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getWorkspace,
  teamsApi,
  workspacesApi,
  type Member,
  type Team,
  type TeamMember,
  type WorkspaceRole,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";
import { Avatar } from "@/components/Avatar";

const SWATCHES = [
  "#7B68EE",
  "#5B5FEF",
  "#00B8D9",
  "#36B37E",
  "#FFAB00",
  "#FF7452",
  "#E5578C",
  "#8777D9",
];

/* ------------------------------------------------------------------ *
 * Create-team modal.
 * ------------------------------------------------------------------ */
function CreateTeamModal({
  members,
  onClose,
  onCreated,
}: {
  members: Member[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (id: string): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await teamsApi.create({
        name: name.trim(),
        color,
        memberUserIds: picked.size ? [...picked] : undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the team.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create team"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.team}</span>
            <div>
              <h2>New team</h2>
              <p className="muted share-sub">Group members to share and mention together.</p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        <form className="modal-body" onSubmit={(e) => void submit(e)}>
          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="teamName">
              Team name
            </label>
            <input
              id="teamName"
              className="input"
              autoFocus
              placeholder="e.g. Design, Marketing, Leadership"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <span className="label">Color</span>
            <div className="team-swatches">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`team-swatch${color === c ? " sel" : ""}`}
                  style={{ background: c }}
                  aria-label={c}
                  onClick={() => setColor(c)}
                >
                  {color === c && Icons.check}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="label">Members {picked.size > 0 && `(${picked.size})`}</span>
            {members.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.86rem" }}>
                No workspace members to add yet.
              </p>
            ) : (
              <div className="team-pick-list">
                {members.map((m) => {
                  const on = picked.has(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`team-pick${on ? " on" : ""}`}
                      onClick={() => toggle(m.id)}
                    >
                      <Avatar
                        name={m.fullName || m.email}
                        id={m.id}
                        avatarUrl={m.avatarUrl}
                        className="avatar-sm"
                      />
                      <span className="team-pick-body">
                        <span className="team-pick-name">{m.fullName || m.email}</span>
                        <span className="team-pick-sub">{m.email}</span>
                      </span>
                      {m.role === "guest" && (
                        <span className="badge role-guest">Guest</span>
                      )}
                      <span className={`team-check${on ? " on" : ""}`}>
                        {on && Icons.check}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
              {busy ? <span className="spinner" /> : "Create team"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Manage-team modal.
 * ------------------------------------------------------------------ */
function ManageTeamModal({
  teamId,
  canManage,
  members,
  onClose,
  onChanged,
}: {
  teamId: string;
  canManage: boolean;
  members: Member[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [roster, setRoster] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");

  const load = async (): Promise<void> => {
    try {
      const d = await teamsApi.get(teamId);
      setName(d.team.name);
      setColor(d.team.color || SWATCHES[0]);
      setRoster(d.members);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the team.");
      setRoster([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const rosterIds = useMemo(
    () => new Set((roster ?? []).map((m) => m.userId)),
    [roster],
  );
  const addable = useMemo(() => {
    const needle = addQuery.trim().toLowerCase();
    return members
      .filter((m) => !rosterIds.has(m.id))
      .filter((m) =>
        needle ? `${m.fullName} ${m.email}`.toLowerCase().includes(needle) : true,
      );
  }, [members, rosterIds, addQuery]);

  const saveName = (): void => {
    const trimmed = name.trim();
    if (!canManage || !trimmed) return;
    void run(() => teamsApi.update(teamId, { name: trimmed }));
  };
  const saveColor = (c: string): void => {
    if (!canManage) return;
    setColor(c);
    void run(() => teamsApi.update(teamId, { color: c }));
  };
  const addMember = (userId: string): void => {
    if (!canManage) return;
    setAddQuery("");
    setAddOpen(false);
    void run(() => teamsApi.addMember(teamId, userId));
  };
  const removeMember = (userId: string): void => {
    if (!canManage) return;
    void run(() => teamsApi.removeMember(teamId, userId));
  };
  const deleteTeam = (): void => {
    if (!canManage) return;
    if (!window.confirm(`Delete the “${name}” team? This can't be undone.`)) return;
    void run(async () => {
      await teamsApi.remove(teamId);
      onChanged();
      onClose();
    });
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Manage team"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="share-team-dot lg" style={{ background: color }}>
              {Icons.team}
            </span>
            <div>
              <h2>{name || "Team"}</h2>
              <p className="muted share-sub">
                {canManage ? "Manage members and details." : "Team roster (read-only)."}
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          {canManage && (
            <>
              <div className="field">
                <label className="label" htmlFor="renameTeam">
                  Name
                </label>
                <div className="share-add-row">
                  <input
                    id="renameTeam"
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={saveName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveName();
                      }
                    }}
                  />
                </div>
              </div>

              <div className="field">
                <span className="label">Color</span>
                <div className="team-swatches">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`team-swatch${color === c ? " sel" : ""}`}
                      style={{ background: c }}
                      aria-label={c}
                      disabled={busy}
                      onClick={() => saveColor(c)}
                    >
                      {color === c && Icons.check}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="share-list-title">
            Members {roster && `· ${roster.length}`}
          </div>

          {canManage && (
            <div className="share-add">
              <div className="share-add-input">
                {Icons.plus}
                <input
                  className="share-add-field"
                  placeholder="Add a member…"
                  value={addQuery}
                  onChange={(e) => {
                    setAddQuery(e.target.value);
                    setAddOpen(true);
                  }}
                  onFocus={() => setAddOpen(true)}
                />
              </div>
              {addOpen && (
                <div className="share-picker">
                  {addable.length === 0 ? (
                    <div className="share-picker-empty">
                      {addQuery.trim()
                        ? "No matching members."
                        : "Everyone is already on this team."}
                    </div>
                  ) : (
                    addable.slice(0, 8).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="share-picker-hit"
                        disabled={busy}
                        onClick={() => addMember(m.id)}
                      >
                        <Avatar
                          name={m.fullName || m.email}
                          id={m.id}
                          avatarUrl={m.avatarUrl}
                          className="avatar-sm"
                        />
                        <span className="share-picker-body">
                          <span className="share-picker-name">
                            {m.fullName || m.email}
                            {m.role === "guest" && (
                              <span className="badge role-guest share-guest-tag">Guest</span>
                            )}
                          </span>
                          <span className="share-picker-sub">{m.email}</span>
                        </span>
                        <span className="share-picker-add">{Icons.plus}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          <div className="share-list">
            {roster === null ? (
              <span className="skel" style={{ width: "100%", height: 44 }} />
            ) : roster.length === 0 ? (
              <div className="share-empty">No members on this team yet.</div>
            ) : (
              roster.map((m) => (
                <div key={m.userId} className="share-entry">
                  <Avatar
                    name={m.fullName || m.email}
                    id={m.userId}
                    avatarUrl={m.avatarUrl}
                    className="avatar-sm"
                  />
                  <span className="share-entry-body">
                    <span className="share-entry-name">{m.fullName || m.email}</span>
                    <span className="share-entry-sub">{m.email}</span>
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      className="icon-btn share-remove"
                      aria-label={`Remove ${m.fullName || m.email}`}
                      title="Remove from team"
                      disabled={busy}
                      onClick={() => removeMember(m.userId)}
                    >
                      {Icons.close}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {canManage && (
            <div className="modal-foot between">
              <button type="button" className="btn btn-ghost danger-ghost" onClick={deleteTeam}>
                {Icons.trash} Delete team
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Team card.
 * ------------------------------------------------------------------ */
function TeamCard({ team, onOpen }: { team: Team; onOpen: () => void }) {
  const color = team.color || colorFor(team.id);
  const stack = Math.min(team.memberCount, 4);
  return (
    <button type="button" className="card card-hover team-card" onClick={onOpen}>
      <div className="team-card-head">
        <span className="share-team-dot lg" style={{ background: color }}>
          {Icons.team}
        </span>
        <span className="team-card-name">{team.name}</span>
      </div>
      <div className="team-card-foot">
        <div className="team-avatars">
          {Array.from({ length: stack }).map((_, i) => (
            <span
              key={i}
              className="team-av-dot"
              style={{ background: colorFor(`${team.id}:${i}`) }}
            />
          ))}
          {team.memberCount === 0 && <span className="muted team-empty-hint">No members</span>}
        </div>
        <span className="muted team-count">
          {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
        </span>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Page.
 * ------------------------------------------------------------------ */
export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<string | null>(null);

  const canManage = role === "owner" || role === "admin";

  const loadTeams = (): void => {
    teamsApi
      .list()
      .then((r) => setTeams(r.teams ?? []))
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load teams.");
        setTeams([]);
      });
  };

  useEffect(() => {
    const ws = getWorkspace();
    if (ws) setRole(ws.role);
    workspacesApi
      .current()
      .then((r) => setRole(r.role))
      .catch(() => undefined);
    workspacesApi
      .members()
      .then((r) => setMembers(r.members ?? []))
      .catch(() => undefined);
    loadTeams();
  }, []);

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Teams</h1>
          <p className="sub">Group members to share spaces and collaborate.</p>
        </div>
        {canManage && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            {Icons.plus} New team
          </button>
        )}
      </div>

      {loadError && <div className="form-error">{loadError}</div>}

      {!canManage && role !== null && (
        <div className="notice" style={{ marginBottom: 18 }}>
          {Icons.info}
          Only workspace owners and admins can create or edit teams.
        </div>
      )}

      {teams === null ? (
        <div className="team-grid">
          {[0, 1, 2].map((i) => (
            <span key={i} className="skel" style={{ width: "100%", height: 108 }} />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-ic">{Icons.team}</span>
            <h3>No teams yet</h3>
            <p>Create a team to share spaces with a whole group at once.</p>
            {canManage && (
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                {Icons.plus} New team
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="team-grid">
          {teams.map((t) => (
            <TeamCard key={t.id} team={t} onOpen={() => setManaging(t.id)} />
          ))}
        </div>
      )}

      {creating && (
        <CreateTeamModal
          members={members}
          onClose={() => setCreating(false)}
          onCreated={loadTeams}
        />
      )}

      {managing && (
        <ManageTeamModal
          teamId={managing}
          canManage={canManage}
          members={members}
          onClose={() => setManaging(null)}
          onChanged={loadTeams}
        />
      )}
    </div>
  );
}
