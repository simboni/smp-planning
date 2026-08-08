"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  clearWorkspace,
  getIdentityToken,
  getUser,
  setWorkspaceSession,
  workspacesApi,
  type WorkspaceSummary,
} from "@/lib/api";
import { Icons, StackMark } from "@/components/icons";
import { colorFor, firstName, initials } from "@/lib/format";

export default function SelectPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selecting, setSelecting] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState("");
  const [greeting, setGreeting] = useState("");

  useEffect(() => {
    if (!getIdentityToken()) {
      router.replace("/login");
      return;
    }
    // Selecting a fresh workspace — drop any stale access token.
    clearWorkspace();
    const user = getUser();
    if (user) setGreeting(firstName(user.fullName));
    workspacesApi
      .list()
      .then((r) => setWorkspaces(r.workspaces ?? []))
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load your workspaces.");
        setWorkspaces([]);
      });
  }, [router]);

  const enter = async (ws: WorkspaceSummary): Promise<void> => {
    if (selecting) return;
    setSelecting(ws.id);
    setLoadError("");
    try {
      const res = await workspacesApi.selectToken(ws.id);
      // ONE atomic write: the token and the workspace it belongs to must
      // never be stored separately (that let them drift apart, showing one
      // workspace's data under another's name).
      setWorkspaceSession(res.workspace ?? ws, res.accessToken);
      router.replace("/dashboard");
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't open that workspace.");
      setSelecting(null);
    }
  };

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (creating || !name.trim()) return;
    setCreating(true);
    setCreateError("");
    try {
      const { workspace } = await workspacesApi.create(name.trim());
      await enter(workspace);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Couldn't create the workspace.");
      setCreating(false);
    }
  };

  const empty = workspaces !== null && workspaces.length === 0;

  return (
    <div className="centered-page">
      <div className="centered-inner">
        <div className="centered-head">
          <div className="brand">
            <span className="brand-mark">
              <StackMark />
            </span>
            <span className="brand-name">
              Stack<span className="up">Up</span>
            </span>
          </div>
          {empty ? (
            <>
              <h1>Create your first workspace</h1>
              <p>
                {greeting ? `Welcome, ${greeting}! ` : ""}A workspace is where your
                team plans and tracks work together.
              </p>
            </>
          ) : (
            <>
              <h1>Choose a workspace</h1>
              <p>
                {greeting ? `Welcome back, ${greeting}. ` : ""}Pick a workspace to
                jump back in.
              </p>
            </>
          )}
        </div>

        {loadError && <div className="form-error">{loadError}</div>}

        {/* loading skeletons */}
        {workspaces === null && (
          <div className="ws-list">
            {[0, 1, 2].map((i) => (
              <div className="ws-card" key={i} aria-hidden>
                <span className="skel" style={{ width: 44, height: 44, borderRadius: 12 }} />
                <span className="skel" style={{ width: "40%", height: 16 }} />
              </div>
            ))}
          </div>
        )}

        {/* empty state → inline create */}
        {empty && (
          <div className="card">
            <CreateForm
              name={name}
              setName={setName}
              creating={creating}
              error={createError}
              onSubmit={create}
              primaryLabel="Create workspace"
            />
          </div>
        )}

        {/* populated list */}
        {workspaces !== null && workspaces.length > 0 && (
          <div className="ws-list">
            {workspaces.map((ws) => {
              const color = ws.color || colorFor(ws.id);
              const isBusy = selecting === ws.id;
              return (
                <button
                  key={ws.id}
                  className="ws-card"
                  onClick={() => void enter(ws)}
                  disabled={!!selecting}
                >
                  <span className="ws-avatar" style={{ background: color }}>
                    {initials(ws.name)}
                  </span>
                  <span className="ws-card-body">
                    <span className="ws-card-name">{ws.name}</span>
                    <span className="ws-card-meta">
                      {ws.slug} · <span className={`badge role-${ws.role}`}>{ws.role}</span>
                    </span>
                  </span>
                  <span className="ws-card-arrow">
                    {isBusy ? <span className="spinner" /> : Icons.chevronRight}
                  </span>
                </button>
              );
            })}

            {showCreate ? (
              <div className="card">
                <CreateForm
                  name={name}
                  setName={setName}
                  creating={creating}
                  error={createError}
                  onSubmit={create}
                  onCancel={() => {
                    setShowCreate(false);
                    setCreateError("");
                  }}
                  primaryLabel="Create & open"
                />
              </div>
            ) : (
              <button
                className="ws-create"
                onClick={() => setShowCreate(true)}
                disabled={!!selecting}
              >
                <span className="ws-create-ic">{Icons.plus}</span>
                Create new workspace
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateForm({
  name,
  setName,
  creating,
  error,
  onSubmit,
  onCancel,
  primaryLabel,
}: {
  name: string;
  setName: (v: string) => void;
  creating: boolean;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
  onCancel?: () => void;
  primaryLabel: string;
}) {
  return (
    <form onSubmit={onSubmit}>
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label className="label" htmlFor="wsName">
          Workspace name
        </label>
        <input
          id="wsName"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Inc."
          autoFocus
          required
        />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-primary" type="submit" disabled={creating || !name.trim()}>
          {creating ? <span className="spinner" /> : primaryLabel}
        </button>
        {onCancel && (
          <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={creating}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
