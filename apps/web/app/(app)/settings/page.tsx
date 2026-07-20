"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getWorkspace,
  setWorkspace as persistWorkspace,
  workspacesApi,
  type WorkspaceSummary,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";
import { applyBranding } from "@/lib/theme";
import SecuritySettings from "@/components/SecuritySettings";

export default function SettingsPage() {
  const [workspace, setWorkspaceState] = useState<WorkspaceSummary | null>(null);

  const setWorkspace = (ws: WorkspaceSummary) => {
    setWorkspaceState(ws);
    persistWorkspace(ws);
    applyBranding(ws.color);
  };

  useEffect(() => {
    setWorkspaceState(getWorkspace());
    workspacesApi
      .current()
      .then((r) => setWorkspaceState(r.workspace))
      .catch(() => undefined);
  }, []);

  const color = workspace?.color || (workspace ? colorFor(workspace.id) : "#7B68EE");
  const isAdmin = workspace?.role === "owner" || workspace?.role === "admin";

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

      {isAdmin && workspace && (
        <BrandingCard workspace={workspace} onSaved={setWorkspace} />
      )}

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

const PRESET_COLORS = [
  "#7B68EE",
  "#4F46E5",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#8B5CF6",
  "#14B8A6",
  "#64748B",
];

function BrandingCard({
  workspace,
  onSaved,
}: {
  workspace: WorkspaceSummary;
  onSaved: (ws: WorkspaceSummary) => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [color, setColor] = useState(workspace.color || "#7B68EE");
  const [logo, setLogo] = useState(workspace.avatarUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Live-preview the accent as the admin picks it.
  useEffect(() => {
    applyBranding(color);
  }, [color]);

  const dirty =
    name.trim() !== workspace.name ||
    color.toLowerCase() !== (workspace.color || "").toLowerCase() ||
    (logo.trim() || null) !== (workspace.avatarUrl ?? null);

  const save = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const r = await workspacesApi.update({
        name: name.trim(),
        color,
        avatarUrl: logo.trim() || null,
      });
      onSaved(r.workspace);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save branding.");
      // Revert the live preview to the persisted color on failure.
      applyBranding(workspace.color);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <h3>Branding</h3>
      </div>

      <div className="field">
        <label className="label">Workspace name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field">
        <label className="label">Accent color</label>
        <div className="brand-colors">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`brand-swatch${c.toLowerCase() === color.toLowerCase() ? " on" : ""}`}
              style={{ background: c }}
              aria-label={c}
              onClick={() => setColor(c)}
            />
          ))}
          <label className="brand-custom" title="Custom color">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <span className="mono brand-hex">{color.toUpperCase()}</span>
        </div>
      </div>

      <div className="field">
        <label className="label">Logo URL</label>
        <input
          className="input"
          value={logo}
          onChange={(e) => setLogo(e.target.value)}
          placeholder="https://…/logo.png (optional)"
        />
        {logo.trim() && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo.trim()} alt="Logo preview" className="brand-logo-preview" />
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="brand-actions">
        {saved && !dirty && <span className="brand-saved">Saved ✓</span>}
        <button
          className="btn btn-primary btn-sm"
          disabled={busy || !dirty || !name.trim()}
          onClick={save}
        >
          {busy ? <span className="spinner" /> : "Save branding"}
        </button>
      </div>
    </div>
  );
}
