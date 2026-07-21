"use client";

/**
 * Module 9 — Goals home. Every goal you can see, grouped by folder.
 *
 * Each folder header carries a color dot, name, goal count and a ⋯ menu
 * (inline rename / recolor / delete); goals without a folder collect in a
 * trailing "No folder" group. A goal row is the "are we winning" strip:
 * name, owner avatar, due-date chip (red when overdue), a progress bar
 * with % label and the target count. Live: `goal.changed` SSE refetches.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  goalsApi,
  workspacesApi,
  type GoalFolder,
  type GoalSummary,
  type Member,
} from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { Icons } from "@/components/icons";
import {
  clamp01,
  formatDueDate,
  formatPercent,
  isOverdue,
} from "@/lib/format";
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
 * New Goal modal.
 * ------------------------------------------------------------------ */
function NewGoalModal({
  folders,
  members,
  defaultFolderId,
  onClose,
  onCreated,
}: {
  folders: GoalFolder[];
  members: Member[];
  defaultFolderId: string | null;
  onClose: () => void;
  onCreated: (goal: GoalSummary) => void;
}) {
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState(defaultFolderId ?? "");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await goalsApi.create({
        name: trimmed,
        folderId: folderId || undefined,
        ownerUserId: ownerUserId || undefined,
        dueDate: dueDate || undefined,
      });
      onCreated(r.goal);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the goal.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="New goal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.goals}</span>
            <div>
              <h2>New Goal</h2>
              <p className="muted share-sub">Name the outcome — add targets next.</p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}

          <div className="field">
            <label className="label" htmlFor="goal-name">Name</label>
            <input
              id="goal-name"
              className="input"
              placeholder="e.g. Launch v2 to 1,000 users"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="goal-folder">Folder</label>
            <select
              id="goal-folder"
              className="input"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="goal-owner">Owner</label>
            <select
              id="goal-owner"
              className="input"
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
            >
              <option value="">No owner</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.fullName || m.email}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="goal-due">Due date</label>
            <input
              id="goal-due"
              type="date"
              className="input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!name.trim() || busy}
              onClick={() => void submit()}
            >
              {busy ? "Creating…" : "Create Goal"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * New Folder modal.
 * ------------------------------------------------------------------ */
function NewFolderModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await goalsApi.createFolder({ name: trimmed, color });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the folder.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="New goal folder"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-head-body">
            <span className="modal-ic">{Icons.folder}</span>
            <div>
              <h2>New Folder</h2>
              <p className="muted share-sub">Group related goals — quarters, teams, themes.</p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icons.close}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          <div className="field">
            <label className="label" htmlFor="gf-name">Name</label>
            <input
              id="gf-name"
              className="input"
              placeholder="e.g. Q3 2026"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
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
                  style={{ background: c, color: c }}
                  aria-label={c}
                  onClick={() => setColor(c)}
                >
                  {color === c && Icons.check}
                </button>
              ))}
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!name.trim() || busy}
              onClick={() => void submit()}
            >
              {busy ? "Creating…" : "Create Folder"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One goal row.
 * ------------------------------------------------------------------ */
function GoalRow({ goal }: { goal: GoalSummary }) {
  const progress = clamp01(goal.progress);
  const overdue = isOverdue(goal.dueDate);
  return (
    <Link href={`/goal?id=${goal.id}`} className={`goal-row${goal.archived ? " archived" : ""}`}>
      <span className="goal-row-main">
        <span className="goal-row-name">
          {goal.name}
          {goal.archived && <span className="badge badge-soon">Archived</span>}
        </span>
        <span className="goal-row-meta">
          <span className="goal-row-targets">
            {goal.targetCount} {goal.targetCount === 1 ? "target" : "targets"}
          </span>
          {goal.dueDate && (
            <span className={`goal-due-chip${overdue ? " overdue" : ""}`}>
              {Icons.calendar}
              {formatDueDate(goal.dueDate)}
            </span>
          )}
        </span>
      </span>
      {goal.owner ? (
        <Avatar
          name={goal.owner.fullName}
          id={goal.owner.id}
          avatarUrl={goal.owner.avatarUrl}
          className="avatar-sm goal-row-owner"
          title={`Owner — ${goal.owner.fullName}`}
        />
      ) : (
        <span className="goal-row-owner goal-row-noowner" title="No owner">
          {Icons.members}
        </span>
      )}
      <span className="goal-prog">
        <span className="goal-prog-track">
          <span
            className={`goal-prog-fill${progress >= 1 ? " full" : ""}`}
            style={{ width: `${progress * 100}%` }}
          />
        </span>
        <span className={`goal-prog-label${progress >= 1 ? " full" : ""}`}>
          {formatPercent(progress)}
        </span>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * Folder group (header + rows + ⋯ menu).
 * ------------------------------------------------------------------ */
function FolderGroup({
  folder,
  goals,
  onChanged,
  onNewGoal,
}: {
  folder: GoalFolder | null;
  goals: GoalSummary[];
  onChanged: () => void;
  onNewGoal: (folderId: string | null) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [recoloring, setRecoloring] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const commitRename = (): void => {
    setRenaming(false);
    const trimmed = renameVal.trim();
    if (!folder || !trimmed || trimmed === folder.name) return;
    goalsApi
      .updateFolder(folder.id, { name: trimmed })
      .then(onChanged)
      .catch(() => undefined);
  };

  const recolor = (color: string): void => {
    setRecoloring(false);
    if (!folder) return;
    goalsApi
      .updateFolder(folder.id, { color })
      .then(onChanged)
      .catch(() => undefined);
  };

  const remove = (): void => {
    if (!folder) return;
    const ok = window.confirm(
      `Delete the folder “${folder.name}”? Goals inside move to “No folder”.`,
    );
    if (!ok) return;
    goalsApi
      .removeFolder(folder.id)
      .then(onChanged)
      .catch(() => undefined);
  };

  return (
    <section className="goal-group">
      <div className="goal-group-head">
        <span
          className="gf-dot"
          style={{ background: folder ? folder.color : "var(--muted)" }}
          aria-hidden="true"
        />
        {renaming && folder ? (
          <input
            className="dp-rename"
            value={renameVal}
            autoFocus
            onChange={(e) => setRenameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <span className="goal-group-name">{folder ? folder.name : "No folder"}</span>
        )}
        <span className="goal-group-count">{goals.length}</span>
        <span className="goal-group-tools">
          <button
            type="button"
            className="icon-btn"
            aria-label={`New goal in ${folder ? folder.name : "no folder"}`}
            title="New goal here"
            onClick={() => onNewGoal(folder?.id ?? null)}
          >
            {Icons.plus}
          </button>
          {folder && (
            <span className="dp-menu-wrap">
              <button
                type="button"
                className="icon-btn"
                aria-label="Folder menu"
                onClick={(e) => {
                  e.stopPropagation();
                  setRecoloring(false);
                  setMenuOpen((v) => !v);
                }}
              >
                {Icons.more}
              </button>
              {menuOpen && (
                <div className="menu dp-menu" onClick={(e) => e.stopPropagation()}>
                  {recoloring ? (
                    <div className="gf-menu-swatches">
                      {SWATCHES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`team-swatch${folder.color === c ? " sel" : ""}`}
                          style={{ background: c, color: c }}
                          aria-label={c}
                          onClick={() => {
                            recolor(c);
                            setMenuOpen(false);
                          }}
                        >
                          {folder.color === c && Icons.check}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setRenameVal(folder.name);
                          setRenaming(true);
                          setMenuOpen(false);
                        }}
                      >
                        {Icons.edit} Rename
                      </button>
                      <button type="button" onClick={() => setRecoloring(true)}>
                        {Icons.palette} Change color
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setMenuOpen(false);
                          remove();
                        }}
                      >
                        {Icons.trash} Delete folder
                      </button>
                    </>
                  )}
                </div>
              )}
            </span>
          )}
        </span>
      </div>
      {goals.length === 0 ? (
        <div className="goal-group-empty">No goals here yet.</div>
      ) : (
        <div className="goal-rows">
          {goals.map((g) => (
            <GoalRow key={g.id} goal={g} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Page.
 * ------------------------------------------------------------------ */
export default function GoalsPage() {
  const router = useRouter();
  const [folders, setFolders] = useState<GoalFolder[] | null>(null);
  const [goals, setGoals] = useState<GoalSummary[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [creatingGoal, setCreatingGoal] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newGoalFolderId, setNewGoalFolderId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = (): void => {
    Promise.all([goalsApi.listFolders(), goalsApi.list()])
      .then(([f, g]) => {
        setFolders(f.folders);
        setGoals(g.goals);
        setError("");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load your goals.");
        setFolders((prev) => prev ?? []);
        setGoals((prev) => prev ?? []);
      });
  };
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
    workspacesApi
      .members()
      .then((r) => setMembers(r.members))
      .catch(() => undefined);
  }, []);

  useRealtime((e) => {
    if (e.type === "goal.changed") loadRef.current();
  }, []);

  const loading = folders === null || goals === null;
  const archivedCount = (goals ?? []).filter((g) => g.archived).length;
  const visibleGoals = useMemo(
    () => (goals ?? []).filter((g) => showArchived || !g.archived),
    [goals, showArchived],
  );

  const groups = useMemo(() => {
    const sortedFolders = [...(folders ?? [])].sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name),
    );
    const byFolder = new Map<string, GoalSummary[]>();
    const loose: GoalSummary[] = [];
    for (const g of visibleGoals) {
      if (g.folderId && sortedFolders.some((f) => f.id === g.folderId)) {
        const arr = byFolder.get(g.folderId) ?? [];
        arr.push(g);
        byFolder.set(g.folderId, arr);
      } else {
        loose.push(g);
      }
    }
    const byDate = (a: GoalSummary, b: GoalSummary): number =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return {
      folders: sortedFolders.map((f) => ({
        folder: f,
        goals: (byFolder.get(f.id) ?? []).sort(byDate),
      })),
      loose: loose.sort(byDate),
    };
  }, [folders, visibleGoals]);

  const totallyEmpty =
    !loading && (goals ?? []).length === 0 && (folders ?? []).length === 0;

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Goals</h1>
          <p className="sub">Set the targets. Watch the bars fill.</p>
        </div>
        <div className="goal-head-actions">
          {archivedCount > 0 && (
            <button
              type="button"
              className={`chip${showArchived ? " active" : ""}`}
              onClick={() => setShowArchived((v) => !v)}
            >
              {Icons.archive}
              Archived
              <span className="chip-count">{archivedCount}</span>
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setCreatingFolder(true)}>
            {Icons.folder}
            New Folder
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setNewGoalFolderId(null);
              setCreatingGoal(true);
            }}
          >
            {Icons.plus}
            New Goal
          </button>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <div className="goal-rows">
          <span className="skel" style={{ height: 64, borderRadius: 12 }} />
          <span className="skel" style={{ height: 64, borderRadius: 12 }} />
          <span className="skel" style={{ height: 64, borderRadius: 12 }} />
        </div>
      ) : totallyEmpty ? (
        <div className="empty-state">
          <span className="empty-ic">{Icons.goals}</span>
          <h3>No goals yet</h3>
          <p>
            Goals turn ambition into progress bars — set a target, link the
            work, and watch it fill.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setNewGoalFolderId(null);
              setCreatingGoal(true);
            }}
          >
            {Icons.plus}
            Create your first goal
          </button>
        </div>
      ) : (
        <>
          {groups.folders.map(({ folder, goals: fg }) => (
            <FolderGroup
              key={folder.id}
              folder={folder}
              goals={fg}
              onChanged={load}
              onNewGoal={(fid) => {
                setNewGoalFolderId(fid);
                setCreatingGoal(true);
              }}
            />
          ))}
          {(groups.loose.length > 0 || groups.folders.length === 0) && (
            <FolderGroup
              folder={null}
              goals={groups.loose}
              onChanged={load}
              onNewGoal={(fid) => {
                setNewGoalFolderId(fid);
                setCreatingGoal(true);
              }}
            />
          )}
        </>
      )}

      {creatingGoal && (
        <NewGoalModal
          folders={folders ?? []}
          members={members}
          defaultFolderId={newGoalFolderId}
          onClose={() => setCreatingGoal(false)}
          onCreated={(goal) => router.push(`/goal?id=${goal.id}`)}
        />
      )}
      {creatingFolder && (
        <NewFolderModal
          onClose={() => setCreatingFolder(false)}
          onCreated={() => {
            setCreatingFolder(false);
            load();
          }}
        />
      )}
    </div>
  );
}
