"use client";

import { useState } from "react";
import { aiApi, type AiSource, type AiWriteAction } from "@/lib/api";
import { Icons } from "@/components/icons";

/**
 * Module 15 — AI Brain UI affordances. Each control degrades gracefully: when
 * no model key is configured the API returns a heuristic result flagged with
 * `source: "heuristic"`, which we badge so the user knows it wasn't a model.
 */

const WRITE_LABELS: { action: AiWriteAction; label: string }[] = [
  { action: "improve", label: "Improve writing" },
  { action: "expand", label: "Expand" },
  { action: "shorten", label: "Make shorter" },
  { action: "fix", label: "Fix spelling & grammar" },
];

/** Rewrite a block of text in place via the AI Brain. */
export function AiWriterButton({
  text,
  onReplace,
  disabled,
}: {
  text: string;
  onReplace: (next: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<AiWriteAction | null>(null);

  const run = async (action: AiWriteAction) => {
    setBusy(action);
    try {
      const r = await aiApi.write(action, text);
      onReplace(r.text);
      setOpen(false);
    } finally {
      setBusy(null);
    }
  };

  const empty = !text.trim();
  return (
    <div className="ai-wrap">
      <button
        type="button"
        className="ai-btn"
        disabled={disabled || empty}
        title={empty ? "Write something first" : "AI writing tools"}
        onClick={() => setOpen((o) => !o)}
      >
        {Icons.zap} AI
      </button>
      {open && (
        <>
          <div className="ai-scrim" onClick={() => setOpen(false)} />
          <div className="ai-menu">
            {WRITE_LABELS.map((w) => (
              <button
                key={w.action}
                type="button"
                className="ai-menu-item"
                disabled={busy !== null}
                onClick={() => run(w.action)}
              >
                {busy === w.action ? "Working…" : w.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Show an AI summary of a task inline. */
export function AiSummaryButton({ taskId }: { taskId: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [source, setSource] = useState<AiSource | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await aiApi.taskSummary(taskId);
      setSummary(r.text);
      setSource(r.source);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-summary">
      <button type="button" className="ai-btn" onClick={run} disabled={busy}>
        {Icons.zap} {busy ? "Summarizing…" : "Summarize"}
      </button>
      {summary && (
        <div className="ai-summary-out">
          <div className="ai-summary-head">
            <span>AI summary</span>
            {source === "heuristic" && (
              <span className="ai-badge">offline</span>
            )}
            <button
              type="button"
              className="ai-summary-x"
              onClick={() => setSummary(null)}
            >
              {Icons.close}
            </button>
          </div>
          <div className="ai-summary-body">
            {summary.split("\n").map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Generate suggested subtasks and hand them to the caller to create. */
export function AiSubtaskButton({
  taskId,
  onGenerated,
}: {
  taskId: string;
  onGenerated: (items: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await aiApi.taskSubtasks(taskId);
      onGenerated(r.items);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="ai-btn" onClick={run} disabled={busy}>
      {Icons.zap} {busy ? "Generating…" : "AI subtasks"}
    </button>
  );
}
