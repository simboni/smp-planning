"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  hierarchyApi,
  permissionAtLeast,
  sprintsApi,
  type FolderWithLists,
  type List,
  type Space,
  type Sprint,
} from "@/lib/api";
import { useHierarchy } from "@/components/HierarchyProvider";
import { Icons } from "@/components/icons";
import { ShareDialog } from "@/components/ShareDialog";
import {
  colorFor,
  formatDateRange,
  localYmd,
  shiftYmd,
  sprintPhase,
  toDateInputValue,
} from "@/lib/format";

function ListRow({ list }: { list: List }) {
  const dot = list.color || colorFor(list.id);
  return (
    <Link href={`/list?id=${list.id}`} className="sp-list">
      <span className="sp-list-dot" style={{ background: dot }} />
      <span className="sp-list-name">{list.name}</span>
      <span className="sp-list-arrow">{Icons.chevronRight}</span>
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * Module 10 — one sprint row: name → the sprint's list, dates chip,
 * points progress, phase badge, Report link and a ⋯ menu.
 * ------------------------------------------------------------------ */
function SprintRow({
  sprint,
  canEdit,
  onChanged,
}: {
  sprint: Sprint;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [editingDates, setEditingDates] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const total = Number(sprint.totalPoints) || 0;
  const completed = Number(sprint.completedPoints) || 0;
  const pct = total > 0 ? Math.min(completed / total, 1) : 0;
  const phase = sprintPhase(sprint.startDate, sprint.endDate);

  const commitRename = (): void => {
    setRenaming(false);
    const v = renameVal.trim();
    if (!v || v === sprint.name) return;
    sprintsApi.update(sprint.id, { name: v }).then(onChanged).catch(() => undefined);
  };

  const commitDates = (): void => {
    setEditingDates(false);
    if (!start || !end || end < start) return;
    sprintsApi
      .update(sprint.id, { startDate: start, endDate: end })
      .then(onChanged)
      .catch(() => undefined);
  };

  const toggleArchive = (): void => {
    setMenuOpen(false);
    sprintsApi
      .update(sprint.id, { archived: !sprint.archived })
      .then(onChanged)
      .catch(() => undefined);
  };

  const remove = (): void => {
    setMenuOpen(false);
    if (!window.confirm(`Delete “${sprint.name}”? Its list and tasks go with it.`)) return;
    sprintsApi.remove(sprint.id).then(onChanged).catch(() => undefined);
  };

  return (
    <div className={`spr-row${sprint.archived ? " archived" : ""}`}>
      <span className="spr-row-ic">{Icons.gantt}</span>

      <span className="spr-row-main">
        {renaming ? (
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
          <Link href={`/list?id=${sprint.listId}`} className="spr-row-name">
            {sprint.name}
          </Link>
        )}

        {editingDates ? (
          <span className="spr-dates-edit" onClick={(e) => e.stopPropagation()}>
            <input
              type="date"
              className="input spr-date-input"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <span className="muted">→</span>
            <input
              type="date"
              className="input spr-date-input"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={commitDates}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setEditingDates(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <span className="spr-row-meta">
            <span className="spr-date-chip">
              {Icons.calendar}
              {formatDateRange(sprint.startDate, sprint.endDate)}
            </span>
            {sprint.archived ? (
              <span className="badge badge-soon">Archived</span>
            ) : (
              <span className={`badge spr-badge-${phase}`}>
                {phase === "active" ? "Active" : phase === "upcoming" ? "Upcoming" : "Past"}
              </span>
            )}
          </span>
        )}
      </span>

      <span className="spr-points" title={`${completed} of ${total} points done`}>
        <span className="spr-points-track">
          <span
            className={`spr-points-fill${total > 0 && completed >= total ? " full" : ""}`}
            style={{ width: `${pct * 100}%` }}
          />
        </span>
        <span className="spr-points-label">
          {completed}/{total} pts
        </span>
      </span>

      <Link href={`/sprint?id=${sprint.id}`} className="btn btn-ghost btn-sm spr-report-link">
        {Icons.trendUp} Report
      </Link>

      {canEdit && (
        <span className="dp-menu-wrap">
          <button
            type="button"
            className="icon-btn"
            aria-label="Sprint menu"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            {Icons.more}
          </button>
          {menuOpen && (
            <div className="menu dp-menu" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => {
                  setRenameVal(sprint.name);
                  setRenaming(true);
                  setMenuOpen(false);
                }}
              >
                {Icons.edit} Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  setStart(toDateInputValue(sprint.startDate));
                  setEnd(toDateInputValue(sprint.endDate));
                  setEditingDates(true);
                  setMenuOpen(false);
                }}
              >
                {Icons.calendar} Edit dates
              </button>
              <button type="button" onClick={toggleArchive}>
                {Icons.archive} {sprint.archived ? "Unarchive" : "Archive"}
              </button>
              <button type="button" className="danger" onClick={remove}>
                {Icons.trash} Delete sprint
              </button>
            </div>
          )}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Module 10 — the Sprints section of a space page.
 * ------------------------------------------------------------------ */
function SprintsSection({ spaceId, canEdit }: { spaceId: string; canEdit: boolean }) {
  const router = useRouter();
  const { reload } = useHierarchy();
  const [sprints, setSprints] = useState<Sprint[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = (): void => {
    sprintsApi
      .list(spaceId)
      .then((r) => setSprints(r.sprints))
      .catch(() => setSprints([]));
  };

  useEffect(() => {
    setSprints(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  const beginAdd = (): void => {
    const n = (sprints?.length ?? 0) + 1;
    setName(`Sprint ${n}`);
    const today = localYmd(new Date());
    setStart(today);
    setEnd(shiftYmd(today, 13)); // two weeks, inclusive
    setError("");
    setAdding(true);
  };

  const submit = async (): Promise<void> => {
    if (busy || !start || !end) return;
    if (end < start) {
      setError("The sprint has to end after it starts.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await sprintsApi.create(spaceId, {
        ...(name.trim() ? { name: name.trim() } : {}),
        startDate: start,
        endDate: end,
      });
      void reload(); // the sprint IS a list — the sidebar tree gains one
      router.push(`/list?id=${r.sprint.listId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the sprint.");
      setBusy(false);
    }
  };

  const list = sprints ?? [];
  const active = list.filter((s) => !s.archived);
  const archived = list.filter((s) => s.archived);

  return (
    <div className="sp-group spr-section">
      <div className="sp-group-head">
        <span className="sp-group-ic">{Icons.gantt}</span>
        <h3>Sprints</h3>
        {sprints !== null && <span className="badge badge-soft">{list.length}</span>}
        {canEdit && (
          <button type="button" className="btn btn-ghost btn-sm spr-add-btn" onClick={beginAdd}>
            {Icons.plus} New Sprint
          </button>
        )}
      </div>

      {adding && (
        <div className="card spr-add-card">
          {error && <div className="form-error">{error}</div>}
          <div className="spr-add-fields">
            <input
              className="input spr-add-name"
              placeholder="Sprint name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <input
              type="date"
              className="input spr-date-input"
              aria-label="Start date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <span className="muted">→</span>
            <input
              type="date"
              className="input spr-date-input"
              aria-label="End date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || !start || !end}
              onClick={() => void submit()}
            >
              {busy ? "Creating…" : "Create"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {sprints === null ? (
        <span className="skel" style={{ height: 56, borderRadius: 12 }} />
      ) : list.length === 0 && !adding ? (
        <div className="sp-group-empty">
          No sprints yet{canEdit ? " — plan your first two weeks." : "."}
        </div>
      ) : (
        <div className="spr-rows">
          {active.map((s) => (
            <SprintRow key={s.id} sprint={s} canEdit={canEdit} onChanged={load} />
          ))}
          {archived.map((s) => (
            <SprintRow key={s.id} sprint={s} canEdit={canEdit} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function SpaceView() {
  const search = useSearchParams();
  const id = search.get("id");
  const { reload } = useHierarchy();

  const [space, setSpace] = useState<Space | null>(null);
  const [folders, setFolders] = useState<FolderWithLists[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<null | "folder" | "list">(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);

  const load = (): void => {
    if (!id) return;
    setLoading(true);
    hierarchyApi
      .getSpace(id)
      .then((r) => {
        setSpace(r.space);
        setFolders(r.folders ?? []);
        setLists(r.lists ?? []);
        setError("");
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load this space."),
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const submit = async (): Promise<void> => {
    const name = draft.trim();
    if (!id || !name || busy) {
      setAdding(null);
      setDraft("");
      return;
    }
    setBusy(true);
    try {
      if (adding === "folder") await hierarchyApi.createFolder(id, { name });
      else await hierarchyApi.createList(id, { name, folderId: null });
      setDraft("");
      setAdding(null);
      load();
      void reload();
    } catch {
      /* keep the input open so the user can retry */
    } finally {
      setBusy(false);
    }
  };

  if (!id) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-ic">{Icons.spaces}</span>
          <h3>No space selected</h3>
          <p>Pick a space from the sidebar to see its contents.</p>
          <Link href="/everything" className="btn btn-soft">Browse spaces</Link>
        </div>
      </div>
    );
  }

  if (loading && !space) {
    return (
      <div className="page">
        <span className="skel" style={{ width: 220, height: 32, marginBottom: 18 }} />
        <span className="skel" style={{ width: "100%", height: 60, marginBottom: 10 }} />
        <span className="skel" style={{ width: "100%", height: 60 }} />
      </div>
    );
  }

  if (error || !space) {
    return (
      <div className="page">
        <div className="form-error">{error || "Space not found."}</div>
        <Link href="/everything" className="btn btn-soft">Back to Everything</Link>
      </div>
    );
  }

  const color = space.color || colorFor(space.id);
  const totalLists = lists.length + folders.reduce((n, f) => n + f.lists.length, 0);
  const canEdit = permissionAtLeast(space.myPermission, "edit");
  const canManage = space.myPermission === "full";

  return (
    <div className="page">
      <div className="sp-head">
        <span className="sp-icon" style={{ background: color }}>
          {space.icon ?? Icons.spaces}
        </span>
        <div className="sp-head-body">
          <h1 style={{ color }}>{space.name}</h1>
          <div className="sp-head-meta">
            {space.isPrivate && (
              <span className="badge sp-private">{Icons.lock} Private</span>
            )}
            <span className="muted">
              {folders.length} {folders.length === 1 ? "folder" : "folders"} · {totalLists}{" "}
              {totalLists === 1 ? "list" : "lists"}
            </span>
          </div>
        </div>
        <div className="sp-head-actions">
          {canManage && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSharing(true)}>
              {Icons.share} Share
            </button>
          )}
          {canEdit && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => { setAdding("folder"); setDraft(""); }}>
                {Icons.folder} Add folder
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => { setAdding("list"); setDraft(""); }}>
                {Icons.plus} Add list
              </button>
            </>
          )}
        </div>
      </div>

      {sharing && (
        <ShareDialog
          spaceId={space.id}
          spaceName={space.name}
          onClose={() => setSharing(false)}
          onChanged={() => { load(); void reload(); }}
        />
      )}

      {adding && (
        <div className="card sp-add-card">
          <input
            autoFocus
            className="input"
            placeholder={adding === "folder" ? "New folder name" : "New list name"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              else if (e.key === "Escape") { setAdding(null); setDraft(""); }
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={() => void submit()} disabled={busy}>
            Create
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setAdding(null); setDraft(""); }}>
            Cancel
          </button>
        </div>
      )}

      {/* Folders */}
      {folders.map((f) => (
        <div key={f.id} className="sp-group">
          <div className="sp-group-head">
            <span className="sp-group-ic">{Icons.folder}</span>
            <h3>{f.name}</h3>
            <span className="badge badge-soft">{f.lists.length}</span>
          </div>
          {f.lists.length === 0 ? (
            <div className="sp-group-empty">No lists in this folder yet.</div>
          ) : (
            <div className="sp-lists">
              {f.lists.map((l) => (
                <ListRow key={l.id} list={l} />
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Folderless lists */}
      {lists.length > 0 && (
        <div className="sp-group">
          {folders.length > 0 && (
            <div className="sp-group-head">
              <span className="sp-group-ic">{Icons.list}</span>
              <h3>Lists</h3>
              <span className="badge badge-soft">{lists.length}</span>
            </div>
          )}
          <div className="sp-lists">
            {lists.map((l) => (
              <ListRow key={l.id} list={l} />
            ))}
          </div>
        </div>
      )}

      {/* Sprints (Module 10) */}
      <SprintsSection spaceId={space.id} canEdit={canEdit} />

      {/* Empty state */}
      {folders.length === 0 && lists.length === 0 && !adding && (
        <div className="card">
          <div className="empty-state">
            <span className="empty-ic">{Icons.list}</span>
            <h3>Nothing here yet</h3>
            {canEdit ? (
              <>
                <p>Create your first list (or a folder to group lists) to get going.</p>
                <div className="hero-actions" style={{ justifyContent: "center" }}>
                  <button className="btn btn-primary" onClick={() => { setAdding("list"); setDraft(""); }}>
                    {Icons.plus} Add a list
                  </button>
                  <button className="btn btn-ghost" onClick={() => { setAdding("folder"); setDraft(""); }}>
                    {Icons.folder} Add a folder
                  </button>
                </div>
              </>
            ) : (
              <p>Nothing has been added to this space yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SpacePage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 220, height: 32 }} />
        </div>
      }
    >
      <SpaceView />
    </Suspense>
  );
}
