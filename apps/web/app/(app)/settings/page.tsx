"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  clearWorkspace,
  getWorkspace,
  limitsApi,
  setWorkspace as persistWorkspace,
  workspacesApi,
  type UsageReport,
  type WorkspaceSummary,
} from "@/lib/api";
import { Icons } from "@/components/icons";
import { colorFor } from "@/lib/format";
import { applyBranding } from "@/lib/theme";
import ProfileSettings from "@/components/ProfileSettings";
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
  const isOwner = workspace?.role === "owner";

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
        <p className="sub">Workspace preferences and configuration.</p>
      </div>

      <ProfileSettings />

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

      <UsageCard />

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

      <Link href="/settings/plans" className="card settings-link">
        <div className="settings-link-ic">{Icons.coin}</div>
        <div className="settings-link-body">
          <div className="setting-label">Plans &amp; billing</div>
          <div className="setting-hint">
            Free, Unlimited, Business and Enterprise — pick your workspace&apos;s plan.
          </div>
        </div>
        <span className="settings-link-arrow">{Icons.chevronRight}</span>
      </Link>

      <div className="sec-heading">Security</div>
      <SecuritySettings />

      {isOwner && workspace && <DangerZone workspace={workspace} />}

    </div>
  );
}

/**
 * Owner-only "Danger zone" — permanently delete the whole workspace. Requires
 * typing the workspace name to arm the button, mirroring GitHub/Stripe's
 * destructive-action pattern so it can't be triggered by a stray click.
 */
function DangerZone({ workspace }: { workspace: WorkspaceSummary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const armed = confirm.trim() === workspace.name.trim();

  const remove = async () => {
    if (!armed) return;
    setBusy(true);
    setError("");
    try {
      await workspacesApi.remove();
      // Drop the now-dead workspace session (keeps the login) and send the
      // owner to the workspace picker.
      clearWorkspace();
      router.replace("/select");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the workspace.");
      setBusy(false);
    }
  };

  return (
    <div className="card danger-zone" style={{ marginTop: 28, marginBottom: 20 }}>
      <div className="card-head">
        <h3>Danger zone</h3>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Delete this workspace</div>
          <div className="setting-hint">
            Permanently removes <strong>{workspace.name}</strong> and everything in it —
            spaces, tasks, docs, dashboards, members and files. This cannot be undone.
          </div>
        </div>
        {!open && (
          <button className="btn btn-danger btn-sm" onClick={() => setOpen(true)}>
            Delete workspace
          </button>
        )}
      </div>

      {open && (
        <div className="danger-confirm">
          <label className="label">
            Type the workspace name <span className="mono">{workspace.name}</span> to confirm
          </label>
          <input
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={workspace.name}
            autoFocus
            disabled={busy}
          />
          {error && <div className="form-error">{error}</div>}
          <div className="danger-actions">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setOpen(false);
                setConfirm("");
                setError("");
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={remove}
              disabled={!armed || busy}
            >
              {busy ? <span className="spinner" /> : "Permanently delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function UsageCard() {
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    limitsApi
      .usage()
      .then(setUsage)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;

  const bar = (percent: number) => (
    <div className="usage-bar">
      <span
        className={`usage-fill${percent >= 90 ? " danger" : percent >= 70 ? " warn" : ""}`}
        style={{ width: `${Math.max(2, percent)}%` }}
      />
    </div>
  );

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <h3>Usage &amp; limits</h3>
      </div>
      {!usage ? (
        <div className="skel" style={{ height: 80 }} />
      ) : (
        <>
          <div className="usage-row">
            <div className="usage-head">
              <span className="setting-label">Storage</span>
              <span className="usage-num">
                {formatBytes(usage.storage.usedBytes)} of{" "}
                {formatBytes(usage.storage.limitBytes)}
              </span>
            </div>
            {bar(usage.storage.percent)}
            <div className="setting-hint">Attachments and clips across all tasks.</div>
          </div>

          <div className="usage-row">
            <div className="usage-head">
              <span className="setting-label">Automations this month</span>
              <span className="usage-num">
                {usage.automations.used.toLocaleString()} of{" "}
                {usage.automations.limit.toLocaleString()}
              </span>
            </div>
            {bar(usage.automations.percent)}
            <div className="setting-hint">
              Rule runs reset on the 1st of each month.
            </div>
          </div>
        </>
      )}
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
