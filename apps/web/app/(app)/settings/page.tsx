"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getWorkspace,
  workspacesApi,
  type WorkspaceSummary,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";
import SecuritySettings from "@/components/SecuritySettings";

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

      <Link href="/settings/integrations" className="card settings-link">
        <div className="settings-link-ic">{Icons.bolt}</div>
        <div className="settings-link-body">
          <div className="setting-label">Integrations &amp; API</div>
          <div className="setting-hint">
            Personal access tokens, webhooks, and import / export.
          </div>
        </div>
        <span className="settings-link-arrow">{Icons.chevronRight}</span>
      </Link>

      <Link href="/settings/roles" className="card settings-link">
        <div className="settings-link-ic">{Icons.lock}</div>
        <div className="settings-link-body">
          <div className="setting-label">Roles &amp; permissions</div>
          <div className="setting-hint">
            Custom roles and fine-grained capabilities for members and guests.
          </div>
        </div>
        <span className="settings-link-arrow">{Icons.chevronRight}</span>
      </Link>

      <Link href="/settings/audit" className="card settings-link">
        <div className="settings-link-ic">{Icons.clock}</div>
        <div className="settings-link-body">
          <div className="setting-label">Audit log</div>
          <div className="setting-hint">
            A tamper-evident record of every change in this workspace.
          </div>
        </div>
        <span className="settings-link-arrow">{Icons.chevronRight}</span>
      </Link>

      <div className="sec-heading">Security</div>
      <SecuritySettings />

      <div className="notice">
        {Icons.info}
        More settings — billing — are coming soon.
      </div>
    </div>
  );
}
