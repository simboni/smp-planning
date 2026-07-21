"use client";

/**
 * FilterBar (Module 5) — compact ClickUp-style chip controls shown under
 * the view tabs in every view: a Filter popover (status / assignee /
 * priority / tag multi-selects + "show done"), a Sort popover (key +
 * direction) and, for List/Board, a Group popover. Active filters render
 * as removable chips.
 */

import { useState } from "react";
import type {
  Member,
  Priority,
  Status,
  Tag,
  ViewConfig,
  ViewGroupBy,
  ViewSort,
  ViewSortKey,
} from "@/lib/api";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { activeFilterCount } from "@/lib/viewUtils";
import { Popover } from "@/components/views/ViewBits";

const SORT_LABEL: Record<ViewSortKey, string> = {
  name: "Name",
  dueDate: "Due date",
  priority: "Priority",
  created: "Created",
  position: "Manual",
};

const GROUP_LABEL: Record<Exclude<ViewGroupBy, null>, string> = {
  status: "Status",
  assignee: "Assignee",
  priority: "Priority",
};

export function FilterBar({
  statuses,
  members,
  tags,
  config,
  onChange,
  showGroup,
}: {
  statuses: Status[];
  members: Member[];
  tags: Tag[];
  config: ViewConfig;
  onChange: (config: ViewConfig) => void;
  showGroup: boolean;
}) {
  const [pop, setPop] = useState<"filter" | "sort" | "group" | null>(null);

  const filters = config.filters ?? {};
  const sort = config.sort ?? null;
  const groupBy = config.groupBy ?? "status";
  const nFilters = activeFilterCount(filters);

  const patchFilters = (patch: Partial<NonNullable<ViewConfig["filters"]>>): void => {
    onChange({ ...config, filters: { ...filters, ...patch } });
  };

  const toggleIn = (arr: string[] | undefined, id: string): string[] =>
    (arr ?? []).includes(id) ? (arr ?? []).filter((x) => x !== id) : [...(arr ?? []), id];

  const setSort = (s: ViewSort | null): void => onChange({ ...config, sort: s });
  const setGroup = (g: ViewGroupBy): void => onChange({ ...config, groupBy: g });

  return (
    <div className="filterbar">
      {/* Filter */}
      <span className="tp-pop-anchor">
        <button
          type="button"
          className={`fb-btn${nFilters > 0 ? " on" : ""}`}
          onClick={() => setPop(pop === "filter" ? null : "filter")}
        >
          {Icons.filter} Filter
          {nFilters > 0 && <span className="fb-badge">{nFilters}</span>}
        </button>
        {pop === "filter" && (
          <Popover onClose={() => setPop(null)} className="fb-pop">
            <div className="fb-pop-section">
              <div className="fb-pop-title">Status</div>
              {statuses.map((s) => {
                const on = (filters.statusIds ?? []).includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`tp-pop-opt${on ? " on" : ""}`}
                    onClick={() => patchFilters({ statusIds: toggleIn(filters.statusIds, s.id) })}
                  >
                    <span className="status-dot" style={{ background: s.color || colorFor(s.id) }} />
                    <span className="tp-pop-opt-body">
                      <span className="tp-pop-opt-name">{s.name}</span>
                    </span>
                    <span className={`tp-check${on ? " on" : ""}`}>{on && Icons.check}</span>
                  </button>
                );
              })}
            </div>

            <div className="fb-pop-section">
              <div className="fb-pop-title">Assignee</div>
              {members.map((m) => {
                const on = (filters.assigneeIds ?? []).includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`tp-pop-opt${on ? " on" : ""}`}
                    onClick={() => patchFilters({ assigneeIds: toggleIn(filters.assigneeIds, m.id) })}
                  >
                    <Avatar
                      name={m.fullName || m.email}
                      id={m.id}
                      avatarUrl={m.avatarUrl}
                      className="avatar-sm"
                    />
                    <span className="tp-pop-opt-body">
                      <span className="tp-pop-opt-name">{m.fullName || m.email}</span>
                    </span>
                    <span className={`tp-check${on ? " on" : ""}`}>{on && Icons.check}</span>
                  </button>
                );
              })}
            </div>

            <div className="fb-pop-section">
              <div className="fb-pop-title">Priority</div>
              {PRIORITY_ORDER.map((p: Priority) => {
                const on = (filters.priorities ?? []).includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    className={`tp-pop-opt${on ? " on" : ""}`}
                    onClick={() =>
                      patchFilters({
                        priorities: (filters.priorities ?? []).includes(p)
                          ? (filters.priorities ?? []).filter((x) => x !== p)
                          : [...(filters.priorities ?? []), p],
                      })
                    }
                  >
                    <span className="prio-flag" style={{ color: PRIORITY_META[p].color }}>
                      {Icons.flag}
                    </span>
                    <span className="tp-pop-opt-body">
                      <span className="tp-pop-opt-name">{PRIORITY_META[p].label}</span>
                    </span>
                    <span className={`tp-check${on ? " on" : ""}`}>{on && Icons.check}</span>
                  </button>
                );
              })}
            </div>

            {tags.length > 0 && (
              <div className="fb-pop-section">
                <div className="fb-pop-title">Tags</div>
                {tags.map((t) => {
                  const on = (filters.tagIds ?? []).includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`tp-pop-opt${on ? " on" : ""}`}
                      onClick={() => patchFilters({ tagIds: toggleIn(filters.tagIds, t.id) })}
                    >
                      <span className="status-dot" style={{ background: t.color || colorFor(t.id) }} />
                      <span className="tp-pop-opt-body">
                        <span className="tp-pop-opt-name">{t.name}</span>
                      </span>
                      <span className={`tp-check${on ? " on" : ""}`}>{on && Icons.check}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="fb-pop-section">
              <button
                type="button"
                className={`tp-pop-opt${filters.includeDone !== false ? " on" : ""}`}
                onClick={() => patchFilters({ includeDone: filters.includeDone === false })}
              >
                <span className="tp-pop-opt-body">
                  <span className="tp-pop-opt-name">Show done tasks</span>
                </span>
                <span className={`tp-check${filters.includeDone !== false ? " on" : ""}`}>
                  {filters.includeDone !== false && Icons.check}
                </span>
              </button>
            </div>

            {nFilters > 0 && (
              <div className="fb-pop-section">
                <button
                  type="button"
                  className="tp-pop-opt fb-clear"
                  onClick={() => {
                    onChange({ ...config, filters: {} });
                    setPop(null);
                  }}
                >
                  {Icons.close}
                  <span className="tp-pop-opt-body">
                    <span className="tp-pop-opt-name">Clear all filters</span>
                  </span>
                </button>
              </div>
            )}
          </Popover>
        )}
      </span>

      {/* Sort */}
      <span className="tp-pop-anchor">
        <button
          type="button"
          className={`fb-btn${sort ? " on" : ""}`}
          onClick={() => setPop(pop === "sort" ? null : "sort")}
        >
          {sort?.dir === "desc" ? Icons.sortDesc : Icons.sortAsc}
          {sort ? `Sort: ${SORT_LABEL[sort.key]}` : "Sort"}
        </button>
        {pop === "sort" && (
          <Popover onClose={() => setPop(null)} className="tp-pop-menu">
            {(["name", "dueDate", "priority", "created"] as ViewSortKey[]).map((key) => {
              const on = sort?.key === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`tp-menu-opt${on ? " on" : ""}`}
                  onClick={() =>
                    setSort(on && sort ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })
                  }
                >
                  <span>{SORT_LABEL[key]}</span>
                  {on && (
                    <span className="tp-menu-check">
                      {sort!.dir === "asc" ? Icons.arrowUp : Icons.arrowDown}
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              className={`tp-menu-opt${sort === null ? " on" : ""}`}
              onClick={() => {
                setSort(null);
                setPop(null);
              }}
            >
              <span>Manual (position)</span>
              {sort === null && <span className="tp-menu-check">{Icons.check}</span>}
            </button>
          </Popover>
        )}
      </span>

      {/* Group (List/Board only) */}
      {showGroup && (
        <span className="tp-pop-anchor">
          <button
            type="button"
            className={`fb-btn${groupBy !== "status" ? " on" : ""}`}
            onClick={() => setPop(pop === "group" ? null : "group")}
          >
            {Icons.group} Group: {GROUP_LABEL[groupBy]}
          </button>
          {pop === "group" && (
            <Popover onClose={() => setPop(null)} className="tp-pop-menu">
              {(Object.keys(GROUP_LABEL) as Exclude<ViewGroupBy, null>[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`tp-menu-opt${groupBy === g ? " on" : ""}`}
                  onClick={() => {
                    setGroup(g);
                    setPop(null);
                  }}
                >
                  <span>{GROUP_LABEL[g]}</span>
                  {groupBy === g && <span className="tp-menu-check">{Icons.check}</span>}
                </button>
              ))}
            </Popover>
          )}
        </span>
      )}

      {/* Active filter chips */}
      <div className="fb-chips">
        {(filters.statusIds ?? []).map((id) => {
          const s = statuses.find((x) => x.id === id);
          if (!s) return null;
          return (
            <FilterChip
              key={`s-${id}`}
              color={s.color || colorFor(s.id)}
              label={s.name}
              onRemove={() => patchFilters({ statusIds: (filters.statusIds ?? []).filter((x) => x !== id) })}
            />
          );
        })}
        {(filters.assigneeIds ?? []).map((id) => {
          const m = members.find((x) => x.id === id);
          if (!m) return null;
          return (
            <FilterChip
              key={`a-${id}`}
              color={colorFor(id)}
              label={m.fullName || m.email}
              onRemove={() =>
                patchFilters({ assigneeIds: (filters.assigneeIds ?? []).filter((x) => x !== id) })
              }
            />
          );
        })}
        {(filters.priorities ?? []).map((p) => (
          <FilterChip
            key={`p-${p}`}
            color={PRIORITY_META[p].color}
            label={PRIORITY_META[p].label}
            onRemove={() =>
              patchFilters({ priorities: (filters.priorities ?? []).filter((x) => x !== p) })
            }
          />
        ))}
        {(filters.tagIds ?? []).map((id) => {
          const t = tags.find((x) => x.id === id);
          if (!t) return null;
          return (
            <FilterChip
              key={`t-${id}`}
              color={t.color || colorFor(t.id)}
              label={t.name}
              onRemove={() => patchFilters({ tagIds: (filters.tagIds ?? []).filter((x) => x !== id) })}
            />
          );
        })}
        {filters.includeDone === false && (
          <FilterChip
            color="#8A8F9C"
            label="Hiding done"
            onRemove={() => patchFilters({ includeDone: true })}
          />
        )}
      </div>
    </div>
  );
}

function FilterChip({
  color,
  label,
  onRemove,
}: {
  color: string;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span
      className="fb-chip"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      {label}
      <button type="button" className="fb-chip-x" aria-label={`Remove ${label} filter`} onClick={onRemove}>
        {Icons.close}
      </button>
    </span>
  );
}
