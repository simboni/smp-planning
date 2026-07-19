"use client";

/**
 * Module 9 — shared portfolio bits: the flattened visible-list index
 * (from the hierarchy) and the list multi-select used by both the
 * "New Portfolio" and "Manage lists" flows.
 */

import { useMemo } from "react";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";

export const PORTFOLIO_SWATCHES = [
  "#7B68EE",
  "#5B5FEF",
  "#00B8D9",
  "#36B37E",
  "#FFAB00",
  "#FF7452",
  "#E5578C",
  "#8777D9",
];

export interface FlatList {
  id: string;
  name: string;
  spaceId: string;
  spaceName: string;
  spaceIcon: string | null;
  group: string;
}

/** Every visible, unarchived list with its space (and folder) context. */
export function useFlatLists(): FlatList[] {
  const { tree } = useHierarchy();
  return useMemo(() => {
    const out: FlatList[] = [];
    for (const space of tree) {
      if (space.archived) continue;
      for (const folder of space.folders) {
        for (const list of folder.lists) {
          if (!list.archived) {
            out.push({
              id: list.id,
              name: list.name,
              spaceId: space.id,
              spaceName: space.name,
              spaceIcon: space.icon,
              group: folder.name,
            });
          }
        }
      }
      for (const list of space.lists) {
        if (!list.archived) {
          out.push({
            id: list.id,
            name: list.name,
            spaceId: space.id,
            spaceName: space.name,
            spaceIcon: space.icon,
            group: "",
          });
        }
      }
    }
    return out;
  }, [tree]);
}

/** List multi-select with space context per row. */
export function ListPicker({
  lists,
  picked,
  onToggle,
}: {
  lists: FlatList[];
  picked: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (lists.length === 0) {
    return (
      <p className="muted" style={{ fontSize: "0.86rem" }}>
        No lists yet — create one inside a Space first.
      </p>
    );
  }
  return (
    <div className="team-pick-list pf-pick-list">
      {lists.map((l) => {
        const on = picked.has(l.id);
        return (
          <button
            key={l.id}
            type="button"
            className={`team-pick${on ? " on" : ""}`}
            onClick={() => onToggle(l.id)}
          >
            <span className="pf-pick-ic">{Icons.list}</span>
            <span className="team-pick-body">
              <span className="team-pick-name">{l.name}</span>
              <span className="team-pick-sub">
                {l.spaceIcon ? `${l.spaceIcon} ` : ""}{l.spaceName}
                {l.group ? ` / ${l.group}` : ""}
              </span>
            </span>
            <span className={`team-check${on ? " on" : ""}`}>{on && Icons.check}</span>
          </button>
        );
      })}
    </div>
  );
}
