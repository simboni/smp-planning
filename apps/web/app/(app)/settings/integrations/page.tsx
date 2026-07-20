"use client";

import { useEffect, useMemo, useState } from "react";
import {
  apiTokensApi,
  hierarchyApi,
  importExportApi,
  webhooksApi,
  type HierarchyTree,
  type PatScope,
  type PatSummary,
  type WebhookSummary,
} from "@/lib/api";
import { Icons } from "@/components/icons";

const EVENT_TYPES = [
  "*",
  "task.changed",
  "comment.changed",
  "doc.changed",
  "goal.changed",
  "board.changed",
  "chat.message",
];

export default function IntegrationsPage() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Integrations &amp; API</h1>
        <p className="sub">
          Personal access tokens, webhooks, and import / export.
        </p>
      </div>
      <ApiTokensCard />
      <WebhooksCard />
      <ImportExportCard />
    </div>
  );
}

/* ---- API tokens --------------------------------------------------- */

function ApiTokensCard() {
  const [tokens, setTokens] = useState<PatSummary[] | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<PatScope>("write");
  const [reveal, setReveal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    apiTokensApi.list().then((r) => setTokens(r.tokens)).catch(() => setTokens([]));
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setBusy(true);
    try {
      const r = await apiTokensApi.create(name.trim() || "API token", scope);
      setReveal(r.token);
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card intg-card">
      <div className="card-head">
        <h3>
          <span className="intg-ic">{Icons.bolt}</span> Personal access tokens
        </h3>
      </div>
      <p className="intg-desc">
        Use a token as a Bearer credential against the public REST API at{" "}
        <code className="mono">/api/v1</code>. Read tokens allow GET only.
      </p>

      {reveal && (
        <div className="intg-reveal">
          <div className="intg-reveal-label">
            Copy this token now — it won&apos;t be shown again.
          </div>
          <div className="intg-reveal-row">
            <code className="mono intg-token">{reveal}</code>
            <button
              className="btn btn-ghost"
              onClick={() => navigator.clipboard?.writeText(reveal)}
            >
              {Icons.copy} Copy
            </button>
            <button className="btn btn-ghost" onClick={() => setReveal(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      <div className="intg-form">
        <input
          className="input"
          placeholder="Token name (e.g. CI pipeline)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="input intg-select"
          value={scope}
          onChange={(e) => setScope(e.target.value as PatScope)}
        >
          <option value="write">Read &amp; write</option>
          <option value="read">Read only</option>
        </select>
        <button className="btn btn-primary" onClick={create} disabled={busy}>
          {Icons.plus} Generate
        </button>
      </div>

      <div className="intg-list">
        {tokens === null && <div className="skel" style={{ height: 40 }} />}
        {tokens?.length === 0 && (
          <div className="intg-empty">No tokens yet.</div>
        )}
        {tokens?.map((t) => (
          <div key={t.id} className="intg-row">
            <div>
              <div className="intg-row-title">{t.name}</div>
              <div className="intg-row-sub">
                <code className="mono">{t.tokenPrefix}…</code>
                <span className={`badge ${t.scope === "read" ? "" : "role-admin"}`}>
                  {t.scope}
                </span>
                {t.lastUsedAt ? (
                  <span>used {new Date(t.lastUsedAt).toLocaleDateString()}</span>
                ) : (
                  <span>never used</span>
                )}
              </div>
            </div>
            <button
              className="btn btn-ghost intg-danger"
              onClick={() => apiTokensApi.revoke(t.id).then(load)}
              title="Revoke"
            >
              {Icons.trash}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Webhooks ----------------------------------------------------- */

function WebhooksCard() {
  const [hooks, setHooks] = useState<WebhookSummary[] | null>(null);
  const [url, setUrl] = useState("");
  const [event, setEvent] = useState("*");
  const [secret, setSecret] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = () =>
    webhooksApi.list().then((r) => setHooks(r.webhooks)).catch(() => setHooks([]));
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!/^https?:\/\//i.test(url.trim())) return;
    setBusy(true);
    try {
      const r = await webhooksApi.create(url.trim(), [event]);
      setSecret(r.secret);
      setUrl("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const test = async (id: string) => {
    setTested((t) => ({ ...t, [id]: "…" }));
    const r = await webhooksApi.test(id).catch(() => ({ ok: false, statusCode: null }));
    setTested((t) => ({
      ...t,
      [id]: r.ok ? `✓ ${r.statusCode}` : `✕ ${r.statusCode ?? "failed"}`,
    }));
  };

  return (
    <div className="card intg-card">
      <div className="card-head">
        <h3>
          <span className="intg-ic">{Icons.zap}</span> Webhooks
        </h3>
      </div>
      <p className="intg-desc">
        Receive a signed <code className="mono">POST</code> when things change.
        Verify the <code className="mono">X-StackUp-Signature</code> HMAC with
        your endpoint&apos;s secret.
      </p>

      {secret && (
        <div className="intg-reveal">
          <div className="intg-reveal-label">
            Signing secret — copy it now, shown once.
          </div>
          <div className="intg-reveal-row">
            <code className="mono intg-token">{secret}</code>
            <button
              className="btn btn-ghost"
              onClick={() => navigator.clipboard?.writeText(secret)}
            >
              {Icons.copy} Copy
            </button>
            <button className="btn btn-ghost" onClick={() => setSecret(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      <div className="intg-form">
        <input
          className="input"
          placeholder="https://example.com/webhooks/stackup"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <select
          className="input intg-select"
          value={event}
          onChange={(e) => setEvent(e.target.value)}
        >
          {EVENT_TYPES.map((ev) => (
            <option key={ev} value={ev}>
              {ev === "*" ? "All events" : ev}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={create} disabled={busy}>
          {Icons.plus} Add
        </button>
      </div>

      <div className="intg-list">
        {hooks === null && <div className="skel" style={{ height: 40 }} />}
        {hooks?.length === 0 && <div className="intg-empty">No webhooks yet.</div>}
        {hooks?.map((h) => (
          <div key={h.id} className="intg-row">
            <div>
              <div className="intg-row-title mono">{h.url}</div>
              <div className="intg-row-sub">
                {h.events.map((e) => (
                  <span key={e} className="badge">
                    {e}
                  </span>
                ))}
                {tested[h.id] && <span>{tested[h.id]}</span>}
              </div>
            </div>
            <div className="intg-row-actions">
              <button className="btn btn-ghost" onClick={() => test(h.id)}>
                {Icons.send} Test
              </button>
              <button
                className="btn btn-ghost intg-danger"
                onClick={() => webhooksApi.remove(h.id).then(load)}
                title="Delete"
              >
                {Icons.trash}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Import / Export ---------------------------------------------- */

function ImportExportCard() {
  const [tree, setTree] = useState<HierarchyTree | null>(null);
  const [listId, setListId] = useState("");
  const [csv, setCsv] = useState("");
  const [board, setBoard] = useState("");
  const [source, setSource] = useState("trello");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    hierarchyApi
      .getTree()
      .then((t) => setTree(t))
      .catch(() => setTree({ spaces: [] }));
  }, []);

  const lists = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    for (const s of tree?.spaces ?? []) {
      for (const l of s.lists) out.push({ id: l.id, label: `${s.name} / ${l.name}` });
      for (const f of s.folders)
        for (const l of f.lists)
          out.push({ id: l.id, label: `${s.name} / ${f.name} / ${l.name}` });
    }
    return out;
  }, [tree]);

  const doExport = async () => {
    const data = await importExportApi.exportWorkspace();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "stackup-export.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImportCsv = async () => {
    if (!listId || !csv.trim()) return;
    try {
      const r = await importExportApi.importCsv(listId, csv);
      setMsg(`Imported ${r.tasks} task(s) from CSV.`);
      setCsv("");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const doImportBoard = async () => {
    try {
      const parsed = JSON.parse(board);
      const r = await importExportApi.importBoard(source, parsed);
      setMsg(`Imported ${r.tasks} task(s) into ${r.lists} list(s).`);
      setBoard("");
    } catch (e) {
      setMsg(
        e instanceof SyntaxError ? "That isn't valid JSON." : (e as Error).message,
      );
    }
  };

  return (
    <div className="card intg-card">
      <div className="card-head">
        <h3>
          <span className="intg-ic">{Icons.repeat}</span> Import &amp; export
        </h3>
      </div>

      {msg && <div className="intg-msg">{msg}</div>}

      <div className="intg-io">
        <div className="intg-io-col">
          <div className="intg-io-title">Export</div>
          <p className="intg-desc">Download the whole workspace as JSON.</p>
          <button className="btn btn-ghost" onClick={doExport}>
            {Icons.arrowDown} Export workspace (JSON)
          </button>
        </div>

        <div className="intg-io-col">
          <div className="intg-io-title">Import CSV → list</div>
          <select
            className="input"
            value={listId}
            onChange={(e) => setListId(e.target.value)}
          >
            <option value="">Choose a list…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <textarea
            className="input intg-area"
            placeholder="Name,Description&#10;Design spec,Write it&#10;Build it,"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <button className="btn btn-primary" onClick={doImportCsv}>
            Import CSV
          </button>
        </div>

        <div className="intg-io-col">
          <div className="intg-io-title">Import board → new space</div>
          <select
            className="input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="trello">Trello</option>
            <option value="asana">Asana</option>
            <option value="jira">Jira</option>
            <option value="native">StackUp / generic</option>
          </select>
          <textarea
            className="input intg-area"
            placeholder='{"name":"My board","lists":[...]}'
            value={board}
            onChange={(e) => setBoard(e.target.value)}
          />
          <button className="btn btn-primary" onClick={doImportBoard}>
            Import board
          </button>
        </div>
      </div>
    </div>
  );
}
