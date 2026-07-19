/**
 * Module 5 — the shared prop contract every view component receives from
 * the List page shell. Individual views extend this with their extras
 * (quick-add, DnD reorder, inline PATCH helpers).
 */
import type { Member, Status, TaskCard } from "@/lib/api";

export interface ViewProps {
  /** Already filtered + sorted by the shell (lib/viewUtils). */
  tasks: TaskCard[];
  statuses: Status[];
  members: Member[];
  canEdit: boolean;
  onOpenTask: (id: string) => void;
  onChanged: () => void;
  listId: string;
}
