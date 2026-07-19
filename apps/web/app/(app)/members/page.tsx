"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  getWorkspace,
  workspacesApi,
  type Member,
  type WorkspaceRole,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor, initials } from "@/lib/format";

const INVITE_ROLES: WorkspaceRole[] = ["admin", "member", "guest"];

type MemberFilter = "all" | "members" | "guests";

export default function MembersPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [filter, setFilter] = useState<MemberFilter>("all");

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteOk, setInviteOk] = useState("");

  const load = (): void => {
    workspacesApi
      .members()
      .then((r) => setMembers(r.members))
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load members.");
        setMembers([]);
      });
  };

  useEffect(() => {
    const ws = getWorkspace();
    if (ws) setRole(ws.role);
    // Confirm role from the source of truth; falls back to the cached value.
    workspacesApi
      .current()
      .then((r) => setRole(r.role))
      .catch(() => undefined);
    load();
  }, []);

  const canInvite = role === "owner" || role === "admin";

  const guestCount = (members ?? []).filter((m) => m.role === "guest").length;
  const memberCount = (members ?? []).length - guestCount;
  const visible = (members ?? []).filter((m) =>
    filter === "all"
      ? true
      : filter === "guests"
        ? m.role === "guest"
        : m.role !== "guest",
  );

  const invite = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (inviting || !email.trim()) return;
    setInviting(true);
    setInviteError("");
    setInviteOk("");
    try {
      const newMember = await workspacesApi.invite({
        email: email.trim(),
        role: inviteRole,
      });
      // Optimistic: splice the returned member in, then refresh from server.
      setMembers((prev) => (prev ? [...prev, newMember] : [newMember]));
      setInviteOk(`Invited ${newMember.email}.`);
      setEmail("");
      load();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "Couldn't send the invite.");
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Members</h1>
        <p className="sub">Manage who has access to this workspace.</p>
      </div>

      {/* invite form (owner/admin) or notice */}
      {canInvite ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <h3>Invite a member</h3>
          </div>
          {inviteError && <div className="form-error">{inviteError}</div>}
          {inviteOk && (
            <div className="notice" style={{ marginBottom: 12, background: "var(--ok-soft)", color: "var(--ok)" }}>
              {Icons.check}
              {inviteOk}
            </div>
          )}
          <form className="invite-bar" onSubmit={(e) => void invite(e)}>
            <div className="field grow">
              <label className="label" htmlFor="inviteEmail">
                Email address
              </label>
              <input
                id="inviteEmail"
                className="input"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="teammate@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="inviteRole">
                Role
              </label>
              <select
                id="inviteRole"
                className="input"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
              >
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r[0].toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary" type="submit" disabled={inviting}>
              {inviting ? <span className="spinner" /> : "Send invite"}
            </button>
          </form>
        </div>
      ) : (
        role !== null && (
          <div className="notice" style={{ marginBottom: 20 }}>
            {Icons.info}
            Only workspace owners and admins can invite new members.
          </div>
        )
      )}

      {loadError && <div className="form-error">{loadError}</div>}

      {/* filter chips + guest legend */}
      {members !== null && members.length > 0 && (
        <div className="member-toolbar">
          <div className="chips" role="tablist" aria-label="Filter members">
            {(
              [
                { key: "all", label: "All", count: members.length },
                { key: "members", label: "Members", count: memberCount },
                { key: "guests", label: "Guests", count: guestCount },
              ] as { key: MemberFilter; label: string; count: number }[]
            ).map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={filter === c.key}
                className={`chip${filter === c.key ? " active" : ""}`}
                onClick={() => setFilter(c.key)}
              >
                {c.label}
                <span className="chip-count">{c.count}</span>
              </button>
            ))}
          </div>
          <div className="member-legend">
            <span className="badge role-guest">Guest</span>
            <span className="muted">limited, space-scoped access</span>
          </div>
        </div>
      )}

      {/* members table */}
      {members === null ? (
        <div className="card">
          {[0, 1, 2].map((i) => (
            <span key={i} className="skel" style={{ width: "100%", height: 48, marginBottom: 8 }} />
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-ic">{Icons.members}</span>
            <h3>No members yet</h3>
            <p>Invite your teammates to start collaborating.</p>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.id} className={m.role === "guest" ? "row-guest" : undefined}>
                  <td>
                    <div className="cell-user">
                      <span className="avatar avatar-sm" style={{ background: colorFor(m.id) }}>
                        {initials(m.fullName || m.email)}
                      </span>
                      <span className="cell-user-body">
                        <span className="cell-user-name">{m.fullName || "Invited user"}</span>
                        <span className="cell-user-email">{m.email}</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge role-${m.role}`}>{m.role}</span>
                  </td>
                  <td>
                    <span className={`badge status-${m.status}`}>{m.status}</span>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    No {filter === "guests" ? "guests" : "members"} to show.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
