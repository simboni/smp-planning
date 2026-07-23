"use client";

/**
 * Form Responses (Module 11) — a submissions table for one intake form.
 *
 * Responses are reconstructed from the tasks the form created (no extra
 * storage), so this works against existing data. Shows one column per form
 * field, the submission time and the resulting task's status, and lets an
 * admin export everything to CSV or jump to any submission's task.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icons } from "@/components/icons";
import { formsApi, type FormResponses as FormResponsesData } from "@/lib/api";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** RFC-4180-ish CSV cell: quote when needed, double embedded quotes. */
function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function FormResponses({
  formId,
  formName,
  onClose,
}: {
  formId: string;
  formName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<FormResponsesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    formsApi
      .responses(formId)
      .then((r) => !stale && setData(r))
      .catch(() => !stale && setError("Couldn't load responses."));
    return () => {
      stale = true;
    };
  }, [formId]);

  const exportCsv = (): void => {
    if (!data) return;
    const header = ["Submitted", "Status", ...data.form.fields.map((f) => f.label)];
    const rows = data.responses.map((r) => [
      fmtDate(r.createdAt),
      r.statusName ?? "",
      ...data.form.fields.map((f) => (r.values[f.id] ?? "").replace(/\n/g, " ")),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${formName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-responses.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openTask = (r: { taskId: string }): void => {
    onClose();
    router.push(`/list?id=${data?.form.listId}&task=${r.taskId}`);
  };

  const count = data?.responses.length ?? 0;

  return (
    <div className="fr-scrim" onClick={onClose}>
      <div
        className="fr"
        role="dialog"
        aria-modal="true"
        aria-label={`${formName} responses`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="fr-head">
          <div className="fr-head-main">
            <span className="fr-head-ic">{Icons.clipboard}</span>
            <div>
              <div className="fr-head-title">{formName}</div>
              <div className="fr-head-sub">
                {count} {count === 1 ? "response" : "responses"}
              </div>
            </div>
          </div>
          <div className="fr-head-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={exportCsv}
              disabled={!data || count === 0}
            >
              {Icons.download} Export CSV
            </button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              {Icons.close}
            </button>
          </div>
        </header>

        <div className="fr-body">
          {error && <div className="fr-empty">{error}</div>}

          {!error && !data && <div className="fr-empty muted">Loading responses…</div>}

          {data && count === 0 && (
            <div className="fr-empty">
              <div className="fr-empty-ic">{Icons.inbox}</div>
              <div className="fr-empty-title">No responses yet</div>
              <p className="muted">
                Share the form's public link — every submission will appear here
                and as a task in <strong>{data.form.name}</strong>.
              </p>
            </div>
          )}

          {data && count > 0 && (
            <div className="fr-table-wrap">
              <table className="fr-table">
                <thead>
                  <tr>
                    <th className="fr-th-when">Submitted</th>
                    <th className="fr-th-status">Status</th>
                    {data.form.fields.map((f) => (
                      <th key={f.id}>{f.label}</th>
                    ))}
                    <th className="fr-th-open" aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {data.responses.map((r) => (
                    <tr key={r.taskId}>
                      <td className="fr-when">{fmtDate(r.createdAt)}</td>
                      <td>
                        {r.statusName ? (
                          <span className="fr-status">
                            <span
                              className="fr-status-dot"
                              style={{ background: r.statusColor || "var(--muted)" }}
                            />
                            {r.statusName}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      {data.form.fields.map((f) => (
                        <td key={f.id} className="fr-cell">
                          {r.values[f.id] ? (
                            <span title={r.values[f.id]}>{r.values[f.id]}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      ))}
                      <td className="fr-open-cell">
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => openTask(r)}
                          aria-label="Open task"
                          title="Open as task"
                        >
                          {Icons.arrowRight}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
