"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ApiError,
  hierarchyApi,
  type List,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";

interface ListMeta {
  list: List;
  space: { id: string; name: string; color: string; icon: string | null };
  folder: { id: string; name: string } | null;
}

const VIEWS = ["List", "Board", "Calendar"] as const;

function ListView() {
  const search = useSearchParams();
  const id = search.get("id");

  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<(typeof VIEWS)[number]>("List");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    hierarchyApi
      .getList(id)
      .then((r) => {
        setMeta(r);
        setError("");
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load this list."),
      )
      .finally(() => setLoading(false));
  }, [id]);

  if (!id) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-ic">{Icons.list}</span>
          <h3>No list selected</h3>
          <p>Choose a list from the sidebar to open it.</p>
        </div>
      </div>
    );
  }

  if (loading && !meta) {
    return (
      <div className="page">
        <span className="skel" style={{ width: 260, height: 16, marginBottom: 14 }} />
        <span className="skel" style={{ width: 200, height: 30, marginBottom: 18 }} />
        <span className="skel" style={{ width: "100%", height: 180 }} />
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="page">
        <div className="form-error">{error || "List not found."}</div>
        <Link href="/everything" className="btn btn-soft">Back to Everything</Link>
      </div>
    );
  }

  const { list, space, folder } = meta;
  const spaceColor = space.color || colorFor(space.id);
  const listColor = list.color || colorFor(list.id);

  return (
    <div className="page">
      {/* breadcrumb */}
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href={`/space?id=${space.id}`} className="crumb">
          <span className="crumb-dot" style={{ background: spaceColor }} />
          {space.icon ? <span className="crumb-emoji">{space.icon}</span> : null}
          {space.name}
        </Link>
        {folder && (
          <>
            <span className="crumb-sep">{Icons.chevronRight}</span>
            <span className="crumb muted">{Icons.folder} {folder.name}</span>
          </>
        )}
        <span className="crumb-sep">{Icons.chevronRight}</span>
        <span className="crumb current">{list.name}</span>
      </nav>

      {/* header */}
      <div className="list-head">
        <span className="list-head-dot" style={{ background: listColor }} />
        <h1>{list.name}</h1>
      </div>

      {/* view switcher (stub) */}
      <div className="view-tabs" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            className={`view-tab${view === v ? " active" : ""}`}
            onClick={() => setView(v)}
            title={v === "List" ? undefined : `${v} view — coming in the next module`}
          >
            {v}
            {v !== "List" && <span className="view-tab-soon">Soon</span>}
          </button>
        ))}
        <span className="view-tabs-note muted">Views arrive in the next module</span>
      </div>

      {/* tasks placeholder — M3 renders tasks here */}
      <div className="card task-placeholder" data-module="tasks">
        <div className="empty-state">
          <span className="empty-ic">{Icons.tasks}</span>
          <h3>No tasks yet</h3>
          <p>Tasks arrive in Module 3. This is where your list’s work will live.</p>
          <span className="badge badge-soon">Tasks · coming soon</span>
        </div>
      </div>
    </div>
  );
}

export default function ListPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <span className="skel" style={{ width: 260, height: 16 }} />
        </div>
      }
    >
      <ListView />
    </Suspense>
  );
}
