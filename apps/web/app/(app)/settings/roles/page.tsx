"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BASE_ROLE_CAPABILITIES,
  CAPABILITIES,
  CAPABILITY_LABELS,
  governanceApi,
  workspacesApi,
  type Capability,
  type CustomRole,
  type Member,
  type WorkspaceRole,
} from "@/lib/api";
import { Icons } from "@/components/icons";

/** Effective (baseline + overrides) capability set for display. */
function effective(role: CustomRole): Record<Capability, boolean> {
  const base = BASE_ROLE_CAPABILITIES[role.baseRole];
  const eff = { ...base };
  for (const cap of CAPABILITIES) {
    const v = role.capabilities[cap];
    if (typeof v === "boolean") eff[cap] = v;
  }
  return eff;
}

export default function RolesPage() {
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [roles, setRoles] = useState<CustomRole[] | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [editing, setEditing] = useState<CustomRole | null>(null);
  const [creating, setCreating] = useState(false);

  const loadRoles = () =>
    governanceApi.listRoles().then((r) => setRoles(r.roles)).catch(() => setRoles([]));
  const loadMembers = () =>
    workspacesApi.members().then((r) => setMembers(r.members)).catch(() => setMembers([]));

  useEffect(() => {
    workspacesApi
      .current()
      .then((r) => setRole(r.role))
      .catch(() => setRole(null));
    loadRoles();
    loadMembers();
  }, []);

  const isAdmin = role === "owner" || role === "admin";

  if (role && !isAdmin) {
    return (
      <div className="page">
        <SettingsBack />
        <div className="page-head">
          <h1>Roles &amp; permissions</h1>
        </div>
        <div className="notice">
          {Icons.info}
          Only workspace owners and admins can manage custom roles.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <SettingsBack />
      <div className="page-head">
        <h1>Roles &amp; permissions</h1>
        <p className="sub">
          Define custom roles that fine-tune what members and guests can do,
          then assign them to people in your workspace.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <h3>Custom roles</h3>
          {!creating && !editing && (
            <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
              New role
            </button>
          )}
        </div>

        {(creating || editing) && (
          <RoleEditor
            role={editing}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
            onSaved={() => {
              setCreating(false);
              setEditing(null);
              loadRoles();
              loadMembers();
            }}
          />
        )}

        {roles === null ? (
          <div className="skel" style={{ height: 60 }} />
        ) : roles.length === 0 && !creating ? (
          <div className="empty-hint">
            No custom roles yet. Create one to tailor permissions beyond the
            built-in member and guest roles.
          </div>
        ) : (
          <div className="role-list">
            {roles.map((r) => {
              const eff = effective(r);
              const granted = CAPABILITIES.filter((c) => eff[c]);
              return (
                <div className="role-row" key={r.id}>
                  <div className="role-main">
                    <div className="role-name">
                      {r.name}
                      <span className="role-base">from {r.baseRole}</span>
                      {r.memberCount > 0 && (
                        <span className="role-count">
                          {r.memberCount} assigned
                        </span>
                      )}
                    </div>
                    {r.description && (
                      <div className="setting-hint">{r.description}</div>
                    )}
                    <div className="role-caps">
                      {granted.length === 0 ? (
                        <span className="cap-none">No capabilities</span>
                      ) : (
                        granted.map((c) => (
                          <span className="cap-chip" key={c}>
                            {CAPABILITY_LABELS[c]}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="role-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(r)}>
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost btn-sm danger"
                      onClick={async () => {
                        await governanceApi.deleteRole(r.id);
                        loadRoles();
                        loadMembers();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <MembersCard roles={roles ?? []} members={members} onAssign={loadMembers} onReloadRoles={loadRoles} />
    </div>
  );
}

function SettingsBack() {
  return (
    <Link href="/settings" className="back-link">
      {Icons.chevronRight}
      <span>Settings</span>
    </Link>
  );
}

function RoleEditor({
  role,
  onCancel,
  onSaved,
}: {
  role: CustomRole | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [baseRole, setBaseRole] = useState<"member" | "guest">(role?.baseRole ?? "member");
  const [caps, setCaps] = useState<Record<Capability, boolean>>(() => {
    const base = BASE_ROLE_CAPABILITIES[role?.baseRole ?? "member"];
    const start = { ...base };
    if (role) {
      for (const c of CAPABILITIES) {
        const v = role.capabilities[c];
        if (typeof v === "boolean") start[c] = v;
      }
    }
    return start;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Switching base role (create mode only) resets toggles to that role's floor.
  const onBase = (b: "member" | "guest") => {
    setBaseRole(b);
    setCaps({ ...BASE_ROLE_CAPABILITIES[b] });
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Give the role a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (role) {
        await governanceApi.updateRole(role.id, {
          name: name.trim(),
          description: description.trim(),
          capabilities: caps,
        });
      } else {
        await governanceApi.createRole({
          name: name.trim(),
          description: description.trim(),
          baseRole,
          capabilities: caps,
        });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the role.");
      setBusy(false);
    }
  };

  return (
    <div className="role-editor">
      {error && <div className="form-error">{error}</div>}
      <div className="role-editor-grid">
        <div className="field">
          <label className="label">Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Contributor"
            autoFocus
          />
        </div>
        <div className="field">
          <label className="label">Based on</label>
          <select
            className="input"
            value={baseRole}
            disabled={!!role}
            onChange={(e) => onBase(e.target.value as "member" | "guest")}
          >
            <option value="member">Member</option>
            <option value="guest">Guest</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label className="label">Description</label>
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this role is for (optional)"
        />
      </div>

      <div className="cap-grid">
        {CAPABILITIES.map((c) => (
          <label className="cap-toggle" key={c}>
            <input
              type="checkbox"
              checked={caps[c]}
              onChange={(e) => setCaps((p) => ({ ...p, [c]: e.target.checked }))}
            />
            <span>{CAPABILITY_LABELS[c]}</span>
          </label>
        ))}
      </div>

      <div className="role-editor-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
          {busy ? <span className="spinner" /> : role ? "Save changes" : "Create role"}
        </button>
      </div>
    </div>
  );
}

function MembersCard({
  roles,
  members,
  onAssign,
}: {
  roles: CustomRole[];
  members: Member[] | null;
  onAssign: () => void;
  onReloadRoles: () => void;
}) {
  const assignable = useMemo(
    () => (members ?? []).filter((m) => m.role === "member" || m.role === "guest"),
    [members],
  );

  const assign = async (userId: string, value: string) => {
    await governanceApi.assignRole(userId, value || null);
    onAssign();
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Assign roles</h3>
      </div>
      {members === null ? (
        <div className="skel" style={{ height: 60 }} />
      ) : assignable.length === 0 ? (
        <div className="empty-hint">
          Custom roles apply to members and guests. Invite people to assign them
          a role.
        </div>
      ) : (
        <div className="assign-list">
          {assignable.map((m) => (
            <div className="assign-row" key={m.id}>
              <div className="assign-who">
                <div className="assign-name">{m.fullName || m.email}</div>
                <div className="setting-hint">
                  {m.email} · {m.role}
                </div>
              </div>
              <select
                className="input assign-select"
                value={m.customRoleId ?? ""}
                onChange={(e) => assign(m.id, e.target.value)}
              >
                <option value="">Default ({m.role})</option>
                {roles
                  .filter((r) => r.baseRole === m.role || m.role === "member")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
