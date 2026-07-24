"use client";

/**
 * Org chart — the company at a glance.
 *
 * Workspace at the root, departments as branches (typed, colored, head
 * marked), every member beneath their department with their designation.
 * People in several departments appear under each; people in none are
 * grouped at the bottom so nobody is invisible. Pure presentation — data
 * comes from the departments list + roster + members the caller already has.
 */

import { useMemo } from "react";
import {
  DEPARTMENT_KIND_LABEL,
  type Department,
  type DepartmentRosterEntry,
  type Member,
} from "@/lib/api";
import { Avatar } from "@/components/Avatar";
import { Icons } from "@/components/icons";

export function OrgChart({
  workspaceName,
  departments,
  members,
  roster,
  onOpenDepartment,
}: {
  workspaceName: string;
  departments: Department[];
  members: Member[];
  roster: DepartmentRosterEntry[];
  onOpenDepartment?: (id: string) => void;
}) {
  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );

  const byDept = useMemo(() => {
    const map = new Map<string, { member: Member; head: boolean }[]>();
    for (const e of roster) {
      const member = memberById.get(e.userId);
      if (!member) continue;
      const list = map.get(e.departmentId) ?? [];
      list.push({ member, head: e.deptRole === "head" });
      map.set(e.departmentId, list);
    }
    // Heads first, then alphabetical.
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          Number(b.head) - Number(a.head) ||
          (a.member.fullName || a.member.email).localeCompare(
            b.member.fullName || b.member.email,
          ),
      );
    }
    return map;
  }, [roster, memberById]);

  const assigned = useMemo(
    () => new Set(roster.map((e) => e.userId)),
    [roster],
  );
  const unassigned = members.filter(
    (m) => !assigned.has(m.id) && m.status === "active",
  );

  return (
    <div className="oc-scroll">
      <div className="oc">
        <div className="oc-root-wrap">
          <div className="oc-node oc-root">
            <span className="oc-root-name">{workspaceName}</span>
            <span className="oc-root-sub muted">
              {members.length} people · {departments.length} departments
            </span>
          </div>
        </div>

        {departments.length === 0 ? (
          <p className="muted oc-empty">
            No departments yet — create one to grow the chart.
          </p>
        ) : (
          <ul className="oc-branches">
            {departments.map((d) => {
              const people = byDept.get(d.id) ?? [];
              return (
                <li key={d.id} className="oc-branch">
                  <button
                    type="button"
                    className="oc-node oc-dept"
                    style={{ borderTopColor: d.color }}
                    onClick={() => onOpenDepartment?.(d.id)}
                  >
                    <span className="oc-dept-name">
                      <span className="dept-preset-dot" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    {d.kind !== "general" && (
                      <span className="oc-dept-kind muted">
                        {DEPARTMENT_KIND_LABEL[d.kind] ?? d.kind}
                      </span>
                    )}
                    <span className="oc-dept-count muted">
                      {people.length} {people.length === 1 ? "person" : "people"}
                    </span>
                  </button>

                  {people.length > 0 && (
                    <div className="oc-members">
                      {people.map(({ member, head }) => (
                        <div
                          key={member.id}
                          className={`oc-person${head ? " oc-person-head" : ""}`}
                        >
                          <Avatar
                            name={member.fullName || member.email}
                            id={member.id}
                            avatarUrl={member.avatarUrl}
                            className="avatar-sm"
                          />
                          <span className="oc-person-body">
                            <span className="oc-person-name">
                              {member.fullName || member.email}
                              {head && (
                                <span className="badge badge-soft oc-head-tag">
                                  Head
                                </span>
                              )}
                            </span>
                            <span className="oc-person-title muted">
                              {member.title || "—"}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {unassigned.length > 0 && (
          <div className="oc-unassigned">
            <div className="oc-unassigned-head muted">
              {Icons.members} Not in any department · {unassigned.length}
            </div>
            <div className="oc-unassigned-row">
              {unassigned.map((m) => (
                <div key={m.id} className="oc-person">
                  <Avatar
                    name={m.fullName || m.email}
                    id={m.id}
                    avatarUrl={m.avatarUrl}
                    className="avatar-sm"
                  />
                  <span className="oc-person-body">
                    <span className="oc-person-name">{m.fullName || m.email}</span>
                    <span className="oc-person-title muted">{m.title || "—"}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
