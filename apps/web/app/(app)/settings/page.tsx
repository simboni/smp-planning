"use client";

import { useEffect, useState } from "react";
import {
  getWorkspace,
  workspacesApi,
  type WorkspaceSummary,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";

export default function SettingsPage() {
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);

  useEffect(() => {
    setWorkspace(getWorkspace());
    workspacesApi
      .current()
      .then((r) => setWorkspace(r.workspace))
      .catch(() => undefined);
  }, []);

  const color = workspace?.color || (workspace ? colorFor(workspace.id) : "#7B68EE");

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
        <p className="sub">Workspace preferences and configuration.</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <h3>Workspace</h3>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-label">Name</div>
            <div className="setting-hint">The display name for this workspace.</div>
          </div>
          <div style={{ fontWeight: 600 }}>
            {workspace?.name ?? <span className="skel" style={{ width: 120, height: 18 }} />}
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-label">URL slug</div>
            <div className="setting-hint">Used in links to this workspace.</div>
          </div>
          <div className="mono">{workspace?.slug ?? "—"}</div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-label">Color</div>
            <div className="setting-hint">Accent color for the workspace mark.</div>
          </div>
          <div className="swatch">
            <span className="swatch-dot" style={{ background: color }} />
            <span className="mono">{color.toUpperCase()}</span>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-label">Your role</div>
            <div className="setting-hint">Your permission level here.</div>
          </div>
          {workspace ? (
            <span className={`badge role-${workspace.role}`}>{workspace.role}</span>
          ) : (
            <span className="skel" style={{ width: 70, height: 18 }} />
          )}
        </div>
      </div>

      <div className="notice">
        {Icons.info}
        More settings — billing, integrations, and permissions — are coming soon.
      </div>
    </div>
  );
}
