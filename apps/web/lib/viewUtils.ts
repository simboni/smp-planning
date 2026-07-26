/**
 * Views Engine (Module 5) — pure helpers for filtering, sorting and
 * grouping task cards, plus the calendar / gantt date math. No React,
 * no fetches: everything here is deterministic and unit-testable.
 */

import type {
  Priority,
  Status,
  TaskCard,
  ViewConfig,
  ViewFilters,
  ViewGroupBy,
  ViewSort,
} from "@/lib/api";
import { PRIORITY_META } from "@/lib/api";
import { colorFor } from "@/lib/format";

/* ------------------------------------------------------------------ *
 * Priority ordering — urgent > high > normal > low, unset last.
 * ------------------------------------------------------------------ */
const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function priorityRank(p: Priority | null): number {
  return p === null ? 4 : PRIORITY_RANK[p];
}

/* ------------------------------------------------------------------ *
 * Filtering.
 * ------------------------------------------------------------------ */
export function applyFilters(tasks: TaskCard[], filters: ViewFilters | undefined): TaskCard[] {
  if (!filters) return tasks;
  const statusIds = filters.statusIds?.length ? new Set(filters.statusIds) : null;
  const assigneeIds = filters.assigneeIds?.length ? new Set(filters.assigneeIds) : null;
  const priorities = filters.priorities?.length ? new Set(filters.priorities) : null;
  const tagIds = filters.tagIds?.length ? new Set(filters.tagIds) : null;
  const includeDone = filters.includeDone !== false; // default: show done

  return tasks.filter((t) => {
    if (!includeDone && t.status.type === "done") return false;
    if (statusIds && !statusIds.has(t.statusId)) return false;
    if (assigneeIds && !t.assignees.some((a) => assigneeIds.has(a.id))) return false;
    if (priorities && (t.priority === null || !priorities.has(t.priority))) return false;
    if (tagIds && !t.tags.some((tag) => tagIds.has(tag.id))) return false;
    return true;
  });
}

/** Count of active filter dimensions (for the FilterBar badge). */
export function activeFilterCount(filters: ViewFilters | undefined): number {
  if (!filters) return 0;
  let n = 0;
  if (filters.statusIds?.length) n++;
  if (filters.assigneeIds?.length) n++;
  if (filters.priorities?.length) n++;
  if (filters.tagIds?.length) n++;
  if (filters.includeDone === false) n++;
  return n;
}

/* ------------------------------------------------------------------ *
 * Sorting. Null sort → manual (position) order.
 * ------------------------------------------------------------------ */
export function applySort(tasks: TaskCard[], sort: ViewSort | null | undefined): TaskCard[] {
  const out = [...tasks];
  if (!sort) {
    out.sort((a, b) => a.position - b.position);
    return out;
  }
  const dir = sort.dir === "desc" ? -1 : 1;
  out.sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case "name":
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        break;
      case "dueDate": {
        // Nulls always last regardless of direction.
        const av = a.dueDate ? Date.parse(a.dueDate) : null;
        const bv = b.dueDate ? Date.parse(b.dueDate) : null;
        if (av === null && bv === null) cmp = 0;
        else if (av === null) return 1;
        else if (bv === null) return -1;
        else cmp = av - bv;
        break;
      }
      case "priority": {
        const ar = priorityRank(a.priority);
        const br = priorityRank(b.priority);
        // Unset priority stays last in both directions.
        if (ar === 4 && br !== 4) return 1;
        if (br === 4 && ar !== 4) return -1;
        cmp = ar - br;
        break;
      }
      case "created":
        cmp = Date.parse(a.createdAt) - Date.parse(b.createdAt);
        break;
      case "position":
      default:
        cmp = a.position - b.position;
        break;
    }
    if (cmp === 0) cmp = a.position - b.position;
    return cmp * dir;
  });
  return out;
}

/** Filters + sort in one call — what the shell hands every view. */
export function applyView(tasks: TaskCard[], config: ViewConfig): TaskCard[] {
  return applySort(applyFilters(tasks, config.filters), config.sort ?? null);
}

/* ------------------------------------------------------------------ *
 * Grouping — List & Board share the same group descriptors.
 * ------------------------------------------------------------------ */
export interface TaskGroup {
  key: string;
  label: string;
  color: string;
  /** Set when the group IS a status (enables quick-add & board DnD). */
  statusId: string | null;
  tasks: TaskCard[];
}

/**
 * Group tasks for List/Board. Status grouping keeps every status (even
 * empty ones, matching the classic List view); assignee/priority skip
 * empty groups. Multi-assignee tasks land in their first assignee's group.
 */
export function groupTasks(
  tasks: TaskCard[],
  groupBy: ViewGroupBy,
  statuses: Status[],
  /** id → name, required only for space-level "list" grouping. */
  listNames?: Map<string, string>,
): TaskGroup[] {
  const mode = groupBy ?? "status";

  if (mode === "list") {
    const byList = new Map<string, TaskGroup>();
    for (const t of tasks) {
      let g = byList.get(t.listId);
      if (!g) {
        g = {
          key: t.listId,
          label: listNames?.get(t.listId) ?? "List",
          color: colorFor(t.listId),
          statusId: null,
          tasks: [],
        };
        byList.set(t.listId, g);
      }
      g.tasks.push(t);
    }
    return [...byList.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  if (mode === "status") {
    const groups: TaskGroup[] = statuses.map((s) => ({
      key: s.id,
      label: s.name,
      color: s.color || colorFor(s.id),
      statusId: s.id,
      tasks: [],
    }));
    const byId = new Map(groups.map((g) => [g.key, g]));
    for (const t of tasks) {
      let g = byId.get(t.statusId);
      if (!g) {
        g = {
          key: t.statusId,
          label: t.status.name,
          color: t.status.color || colorFor(t.statusId),
          statusId: t.statusId,
          tasks: [],
        };
        byId.set(t.statusId, g);
        groups.push(g);
      }
      g.tasks.push(t);
    }
    return groups;
  }

  if (mode === "priority") {
    const order: (Priority | null)[] = ["urgent", "high", "normal", "low", null];
    const groups: TaskGroup[] = [];
    for (const p of order) {
      const inGroup = tasks.filter((t) => t.priority === p);
      if (inGroup.length === 0) continue;
      groups.push({
        key: p ?? "none",
        label: p ? PRIORITY_META[p].label : "No priority",
        color: p ? PRIORITY_META[p].color : "#8A8F9C",
        statusId: null,
        tasks: inGroup,
      });
    }
    return groups;
  }

  // assignee
  const byUser = new Map<string, TaskGroup>();
  const unassigned: TaskGroup = {
    key: "unassigned",
    label: "Unassigned",
    color: "#8A8F9C",
    statusId: null,
    tasks: [],
  };
  for (const t of tasks) {
    const a = t.assignees[0];
    if (!a) {
      unassigned.tasks.push(t);
      continue;
    }
    let g = byUser.get(a.id);
    if (!g) {
      g = { key: a.id, label: a.fullName, color: colorFor(a.id), statusId: null, tasks: [] };
      byUser.set(a.id, g);
    }
    g.tasks.push(t);
  }
  const groups = [...byUser.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (unassigned.tasks.length > 0) groups.push(unassigned);
  return groups;
}

/* ------------------------------------------------------------------ *
 * Date helpers (calendar & gantt). All day-precision, local time.
 * ------------------------------------------------------------------ */

/** ISO/date string → "yyyy-mm-dd" key in local time; null when invalid. */
export function dayKeyOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return dayKey(d);
}

/** Date → "yyyy-mm-dd". */
export function dayKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Midnight-anchored copy of a date. */
export function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** Whole-day difference b − a (both taken at local midnight). */
export function diffDays(a: Date, b: Date): number {
  return Math.round((atMidnight(b).getTime() - atMidnight(a).getTime()) / 86_400_000);
}

/** Monday that starts the week containing `d`. */
export function startOfWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0 = Sun
  const back = day === 0 ? 6 : day - 1;
  return addDays(atMidnight(d), -back);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

/**
 * A 6-week (42 day) Monday-start grid covering the given month.
 * Each cell carries its date, day key and whether it's inside the month.
 */
export interface CalendarCell {
  date: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
}

export function monthGrid(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month, 1);
  const gridStart = startOfWeekMonday(first);
  const todayKey = dayKey(new Date());
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const key = dayKey(date);
    cells.push({ date, key, inMonth: date.getMonth() === month, isToday: key === todayKey });
  }
  return cells;
}
