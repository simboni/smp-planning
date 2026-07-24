"use client";

/**
 * HR module — departments, designations and org onboarding.
 *
 * The org view of the workspace: departments as cards, each with a head, a
 * roster (every person carrying their designation), and optionally a private
 * home Space the whole department shares. Admins create departments, assign
 * or onboard people (email invites land in the workspace AND the department
 * in one step), set designations, and mark department heads. Everyone else
 * can browse the org structure read-only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  departmentsApi,
  workspacesApi,
  getWorkspace,
  type Department,
  type DepartmentDetail,
  type DepartmentMember,
  type Member,
  type WorkspaceRole,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";
import { Avatar } from "@/components/Avatar";
import { showToast } from "@/lib/toast";

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

const INVITE_ROLES: WorkspaceRole[] = ["member", "admin", "guest"];

/* ------------------------------------------------------------------ *
 * Create-department modal.
 * ------------------------------------------------------------------ */
function CreateDepartmentModal({
  members,
  onClose,
  onCreated,
}: {
  members: Member[];
  onClose: () => void;
  onCreated: (d: Department) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [leadUserId, setLeadUserId] = useState("");
  const [createSpace, setCreateSpace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (): Promise<void> => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await departmentsApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        leadUserId: leadUserId || undefined,
        createSpace,
      });
      onCreated(r.department);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't create the department.",
      );
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="New department"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.org}</span>
            <div>
              <h2>New department</h2>
              <p className="muted share-sub">
                An org unit with a head, a roster and its own private space.
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="dep-name">Name</label>
            <input
              id="dep-name"
              className="input"
              placeholder="e.g. Finance"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="dep-desc">Description (optional)</label>
            <input
              id="dep-desc"
              className="input"
              placeholder="What this department is responsible for"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="label">Color</label>
            <div className="team-swatches">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`team-swatch${color === c ? " sel" : ""}`}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="dep-lead">Department head (optional)</label>
            <select
              id="dep-lead"
              className="input"
              value={leadUserId}
              onChange={(e) => setLeadUserId(e.target.value)}
            >
              <option value="">— No head yet —</option>
              {members
                .filter((m) => m.status === "active")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName || m.email}
                  </option>
                ))}
            </select>
          </div>

          <label className="hr-check">
            <input
              type="checkbox"
              checked={createSpace}
              onChange={(e) => setCreateSpace(e.target.checked)}
            />
            <span>
              Create a private Space for this department
              <span className="muted hr-check-sub">
                Only department members (and admins) can see it. People added to
                the department get access automatically.
              </span>
            </span>
          </label>

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !name.trim()}
              onClick={() => void submit()}
            >
              {busy ? <span className="spinner" /> : "Create department"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Manage-department modal: roster, designations, head, space, settings.
 * ------------------------------------------------------------------ */
function ManageDepartmentModal({
  departmentId,
  members,
  canManage,
  onClose,
  onChanged,
  onDeleted,
}: {
  departmentId: string;
  members: Member[];
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const { tree, reload: reloadTree } = useHierarchy();
  const [detail, setDetail] = useState<DepartmentDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Add-existing-member picker
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  // Invite-by-email onboarding
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [inviteTitle, setInviteTitle] = useState("");

  const load = useCallback((): void => {
    departmentsApi
      .get(departmentId)
      .then((r) => {
        setDetail(r.department);
        setError("");
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Couldn't load the department.",
        ),
      );
  }, [departmentId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (e: MouseEvent): void => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [pickerOpen]);

  const run = async (fn: () => Promise<unknown>, fallback: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const candidates = useMemo(() => {
    if (!detail) return [];
    const inDept = new Set(detail.members.map((m) => m.userId));
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => m.status === "active" && !inDept.has(m.id))
      .filter(
        (m) =>
          !q ||
          m.fullName.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [detail, members, query]);

  const spaces = tree.map((s) => ({ id: s.id, name: s.name }));

  const editDesignation = (m: DepartmentMember): void => {
    const next = window.prompt(
      `Designation for ${m.fullName || m.email}`,
      m.title ?? "",
    );
    if (next === null) return;
    void run(
      () => departmentsApi.updateMember(departmentId, m.userId, { title: next }),
      "Couldn't update the designation.",
    );
  };

  const invite = async (): Promise<void> => {
    const email = inviteEmail.trim();
    if (!email) return;
    await run(async () => {
      await departmentsApi.addMember(departmentId, {
        email,
        role: inviteRole,
        title: inviteTitle.trim() || undefined,
      });
      setInviteEmail("");
      setInviteTitle("");
      showToast(`Onboarded ${email} into ${detail?.name ?? "the department"}`);
    }, "Couldn't onboard that email.");
  };

  const deleteDepartment = (): void => {
    if (!detail) return;
    if (
      !window.confirm(
        `Delete “${detail.name}”? Members and any linked Space stay — only the department (and its access grants) is removed.`,
      )
    ) {
      return;
    }
    void (async () => {
      try {
        await departmentsApi.remove(departmentId);
        onDeleted();
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "Couldn't delete the department.",
        );
      }
    })();
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal hr-modal"
        role="dialog"
        aria-modal="true"
        aria-label={detail?.name ?? "Department"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic" style={{ background: detail?.color ?? undefined }}>
              {Icons.org}
            </span>
            <div>
              <h2>{detail?.name ?? "Department"}</h2>
              <p className="muted share-sub">
                {detail
                  ? `${detail.memberCount} ${detail.memberCount === 1 ? "person" : "people"}${
                      detail.description ? ` · ${detail.description}` : ""
                    }`
                  : "Loading…"}
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          {!detail ? (
            <div className="hr-roster-loading">
              <span className="skel" style={{ width: "70%", height: 14 }} />
              <span className="skel" style={{ width: "90%", height: 14 }} />
              <span className="skel" style={{ width: "60%", height: 14 }} />
            </div>
          ) : (
            <>
              {canManage && (
                <div className="hr-row-2">
                  <div className="field">
                    <label className="label" htmlFor="hr-lead">Department head</label>
                    <select
                      id="hr-lead"
                      className="input"
                      value={detail.lead?.id ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        void run(
                          () =>
                            departmentsApi.update(departmentId, {
                              leadUserId: e.target.value || null,
                            }),
                          "Couldn't update the head.",
                        )
                      }
                    >
                      <option value="">— No head —</option>
                      {members
                        .filter((m) => m.status === "active")
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.fullName || m.email}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="field">
                    <label className="label" htmlFor="hr-space">Home space</label>
                    <select
                      id="hr-space"
                      className="input"
                      value={detail.spaceId ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        void run(async () => {
                          await departmentsApi.update(departmentId, {
                            spaceId: e.target.value || null,
                          });
                          await reloadTree();
                        }, "Couldn't update the home space.")
                      }
                    >
                      <option value="">— No linked space —</option>
                      {spaces.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      {detail.spaceId && !spaces.some((s) => s.id === detail.spaceId) && (
                        <option value={detail.spaceId}>{detail.spaceName ?? "Linked space"}</option>
                      )}
                    </select>
                  </div>
                </div>
              )}

              {detail.spaceId && (
                <button
                  type="button"
                  className="btn btn-soft btn-sm hr-open-space"
                  onClick={() => {
                    onClose();
                    router.push(`/space?id=${detail.spaceId}`);
                  }}
                >
                  {Icons.spaces ?? Icons.org} Open {detail.spaceName ?? "space"}
                </button>
              )}

              {/* Roster */}
              <div className="hr-section-label">People</div>
              {detail.members.length === 0 ? (
                <p className="muted hr-empty-roster">
                  No one in this department yet{canManage ? " — add people below." : "."}
                </p>
              ) : (
                <div className="share-list hr-roster">
                  {detail.members.map((m) => (
                    <div key={m.userId} className="share-entry">
                      <Avatar
                        name={m.fullName || m.email}
                        id={m.userId}
                        avatarUrl={m.avatarUrl}
                        className="avatar-sm"
                      />
                      <span className="share-entry-body">
                        <span className="share-entry-name">
                          {m.fullName || m.email}
                          {m.deptRole === "head" && (
                            <span className="badge badge-soft hr-head-tag">Head</span>
                          )}
                        </span>
                        <span className="share-entry-sub">
                          {m.title ? m.title : <em>No designation</em>}
                          {" · "}
                          {m.role}
                        </span>
                      </span>
                      {canManage && (
                        <span className="hr-entry-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            title="Set designation"
                            onClick={() => editDesignation(m)}
                          >
                            Designation
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () =>
                                  departmentsApi.updateMember(departmentId, m.userId, {
                                    deptRole: m.deptRole === "head" ? "member" : "head",
                                  }),
                                "Couldn't update the role.",
                              )
                            }
                          >
                            {m.deptRole === "head" ? "Unset head" : "Make head"}
                          </button>
                          <button
                            type="button"
                            className="icon-btn share-remove"
                            aria-label={`Remove ${m.fullName || m.email}`}
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => departmentsApi.removeMember(departmentId, m.userId),
                                "Couldn't remove them.",
                              )
                            }
                          >
                            {Icons.close}
                          </button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {canManage && (
                <>
                  {/* Add an existing workspace member */}
                  <div className="share-add" ref={addRef}>
                    <div className="share-add-input">
                      {Icons.members}
                      <input
                        className="share-add-field"
                        placeholder="Add an existing member…"
                        value={query}
                        onFocus={() => setPickerOpen(true)}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setPickerOpen(true);
                        }}
                      />
                    </div>
                    {pickerOpen && candidates.length > 0 && (
                      <div className="share-picker">
                        {candidates.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className="share-picker-hit"
                            onClick={() => {
                              setPickerOpen(false);
                              setQuery("");
                              void run(
                                () =>
                                  departmentsApi.addMember(departmentId, {
                                    userId: m.id,
                                  }),
                                "Couldn't add them.",
                              );
                            }}
                          >
                            <Avatar
                              name={m.fullName || m.email}
                              id={m.id}
                              avatarUrl={m.avatarUrl}
                              className="avatar-sm"
                            />
                            <span className="share-entry-body">
                              <span className="share-entry-name">
                                {m.fullName || m.email}
                              </span>
                              <span className="share-entry-sub">{m.email}</span>
                            </span>
                            <span className={`badge role-${m.role}`}>{m.role}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Onboard someone new straight into the department */}
                  <div className="hr-section-label">Onboard someone new</div>
                  <div className="hr-invite">
                    <input
                      className="input"
                      type="email"
                      placeholder="email@company.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                    <input
                      className="input"
                      placeholder="Designation (e.g. Accountant)"
                      value={inviteTitle}
                      onChange={(e) => setInviteTitle(e.target.value)}
                    />
                    <select
                      className="input"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                      aria-label="Workspace role"
                    >
                      {INVITE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !inviteEmail.trim()}
                      onClick={() => void invite()}
                    >
                      {busy ? <span className="spinner" /> : "Onboard"}
                    </button>
                  </div>
                  <p className="muted hr-invite-hint">
                    They join the workspace with the picked privileges and land in
                    this department immediately.
                  </p>
                </>
              )}
            </>
          )}
        </div>

        {canManage && detail && (
          <div className="modal-foot between">
            <button
              type="button"
              className="btn danger-ghost"
              disabled={busy}
              onClick={deleteDepartment}
            >
              Delete department
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The HR page.
 * ------------------------------------------------------------------ */
export default function HrPage() {
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [role, setRole] = useState<WorkspaceRole | null>(
    () => getWorkspace()?.role ?? null,
  );
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);

  const canManage = role === "owner" || role === "admin";

  const load = useCallback((): void => {
    departmentsApi
      .list()
      .then((r) => {
        setDepartments(r.departments);
        setError("");
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Couldn't load departments.",
        ),
      );
    workspacesApi
      .members()
      .then((r) => setMembers(r.members))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    workspacesApi
      .current()
      .then((r) => setRole(r.role))
      .catch(() => undefined);
  }, [load]);

  const totalPeople = useMemo(
    () => members.filter((m) => m.status === "active").length,
    [members],
  );

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>HR</h1>
          <p className="sub">
            Departments, designations and onboarding —{" "}
            {departments ? `${departments.length} departments` : "…"} ·{" "}
            {totalPeople} people
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreating(true)}
          >
            {Icons.plus} New department
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {!canManage && departments !== null && (
        <div className="notice">
          You can browse the org structure. Owners and admins manage departments
          and onboarding.
        </div>
      )}

      {departments === null ? (
        <div className="team-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card">
              <span className="skel" style={{ width: "60%", height: 18, marginBottom: 10 }} />
              <span className="skel" style={{ width: "40%", height: 12 }} />
            </div>
          ))}
        </div>
      ) : departments.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-ic">{Icons.org}</span>
            <h3>No departments yet</h3>
            <p>
              Structure your organization: Finance, Engineering, Operations…
              each with its head, its people and its own private space.
            </p>
            {canManage && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setCreating(true)}
              >
                {Icons.plus} Create the first department
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="team-grid">
          {departments.map((d) => (
            <button
              key={d.id}
              type="button"
              className="card card-hover team-card hr-card"
              onClick={() => setManagingId(d.id)}
            >
              <span className="hr-card-dot" style={{ background: d.color }}>
                {Icons.org}
              </span>
              <span className="hr-card-body">
                <span className="hr-card-name">{d.name}</span>
                <span className="hr-card-sub muted">
                  {d.memberCount} {d.memberCount === 1 ? "person" : "people"}
                  {d.lead ? ` · Head: ${d.lead.fullName}` : ""}
                </span>
                {d.spaceName && (
                  <span className="badge badge-soft hr-card-space">
                    {d.spaceName}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <CreateDepartmentModal
          members={members}
          onClose={() => setCreating(false)}
          onCreated={(d) => {
            setCreating(false);
            load();
            setManagingId(d.id);
            showToast(`Department created: “${d.name}”`);
          }}
        />
      )}

      {managingId && (
        <ManageDepartmentModal
          departmentId={managingId}
          members={members}
          canManage={canManage}
          onClose={() => setManagingId(null)}
          onChanged={load}
          onDeleted={() => {
            setManagingId(null);
            load();
          }}
        />
      )}
    </div>
  );
}
