"use client";

/**
 * HR module — the people directory.
 *
 * Every person in the workspace with their designation, the departments they
 * belong to (heads marked), workspace role and status — searchable and
 * filterable by department. Admins edit designations inline; departments
 * themselves are managed in the Departments module, and membership/roles in
 * People. The three work hand in hand.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  departmentsApi,
  workspacesApi,
  getWorkspace,
  type Department,
  type DepartmentRosterEntry,
  type Member,
  type WorkspaceRole,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { Avatar } from "@/components/Avatar";

export default function HrPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roster, setRoster] = useState<DepartmentRosterEntry[]>([]);
  const [role, setRole] = useState<WorkspaceRole | null>(
    () => getWorkspace()?.role ?? null,
  );
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("");

  const canManage = role === "owner" || role === "admin";

  const load = useCallback((): void => {
    Promise.all([
      workspacesApi.members(),
      departmentsApi.list(),
      departmentsApi.roster(),
    ])
      .then(([m, d, r]) => {
        setMembers(m.members);
        setDepartments(d.departments);
        setRoster(r.entries);
        setError("");
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Couldn't load the directory.",
        ),
      );
  }, []);

  useEffect(() => {
    load();
    workspacesApi
      .current()
      .then((r) => setRole(r.role))
      .catch(() => undefined);
  }, [load]);

  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );
  const memberDepts = useMemo(() => {
    const map = new Map<string, { dept: Department; head: boolean }[]>();
    for (const e of roster) {
      const dept = deptById.get(e.departmentId);
      if (!dept) continue;
      const list = map.get(e.userId) ?? [];
      list.push({ dept, head: e.deptRole === "head" });
      map.set(e.userId, list);
    }
    return map;
  }, [roster, deptById]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members ?? []).filter((m) => {
      if (deptFilter) {
        const inDept = (memberDepts.get(m.id) ?? []).some(
          (x) => x.dept.id === deptFilter,
        );
        if (!inDept) return false;
      }
      if (!q) return true;
      return (
        m.fullName.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        (m.title ?? "").toLowerCase().includes(q)
      );
    });
  }, [members, query, deptFilter, memberDepts]);

  const setTitle = async (m: Member): Promise<void> => {
    const next = window.prompt(
      `Designation for ${m.fullName || m.email}`,
      m.title ?? "",
    );
    if (next === null) return;
    try {
      const updated = await workspacesApi.updateMember(m.id, { title: next });
      setMembers((prev) =>
        prev ? prev.map((x) => (x.id === m.id ? updated : x)) : prev,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update.");
    }
  };

  const unassigned = (members ?? []).filter(
    (m) => (memberDepts.get(m.id) ?? []).length === 0,
  ).length;

  return (
    <div className="page page-wide">
      <div className="page-head page-head-row">
        <div>
          <h1>HR</h1>
          <p className="sub">
            People directory — {members ? members.length : "…"} people ·{" "}
            {departments.length} departments
            {unassigned > 0 ? ` · ${unassigned} not in any department` : ""}
          </p>
        </div>
        <div className="hr-head-actions">
          <Link href="/departments" className="btn btn-soft">
            {Icons.org} Departments
          </Link>
          <Link href="/people" className="btn btn-soft">
            {Icons.members} Members &amp; Teams
          </Link>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="member-toolbar hr-dir-toolbar">
        <input
          className="input hr-dir-search"
          placeholder="Search by name, email or designation…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="input hr-dir-filter"
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          aria-label="Filter by department"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {members === null ? (
        <div className="card">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="skel"
              style={{ width: `${85 - i * 10}%`, height: 14, marginBottom: 12 }}
            />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-ic">{Icons.members}</span>
            <h3>No people match</h3>
            <p>Try a different search or department filter.</p>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Person</th>
                <th>Designation</th>
                <th>Departments</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const depts = memberDepts.get(m.id) ?? [];
                return (
                  <tr
                    key={m.id}
                    className={m.status === "suspended" ? "row-suspended" : undefined}
                  >
                    <td>
                      <div className="cell-user">
                        <Avatar
                          name={m.fullName || m.email}
                          id={m.id}
                          avatarUrl={m.avatarUrl}
                          className="avatar-sm"
                        />
                        <span className="cell-user-body">
                          <span className="cell-user-name">
                            {m.fullName || "Invited user"}
                          </span>
                          <span className="cell-user-email">{m.email}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      {canManage ? (
                        <button
                          type="button"
                          className="cell-title-btn"
                          title="Set designation"
                          onClick={() => void setTitle(m)}
                        >
                          {m.title || <span className="muted">Set designation…</span>}
                        </button>
                      ) : (
                        <span className={m.title ? undefined : "muted"}>
                          {m.title || "—"}
                        </span>
                      )}
                    </td>
                    <td>
                      {depts.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <span className="hr-dir-depts">
                          {depts.map(({ dept, head }) => (
                            <span
                              key={dept.id}
                              className="badge badge-soft hr-dir-dept"
                            >
                              <span
                                className="dept-preset-dot"
                                style={{ background: dept.color }}
                              />
                              {dept.name}
                              {head ? " · Head" : ""}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`badge role-${m.role}`}>{m.role}</span>
                    </td>
                    <td>
                      <span className={`badge status-${m.status}`}>{m.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
