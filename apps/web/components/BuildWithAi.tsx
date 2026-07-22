"use client";

/**
 * AI Builder (Module 15) — turn one sentence into a real StackUp structure.
 *
 * Three-step flow, all in one modal:
 *   1. prompt   — the user describes what they want
 *   2. preview  — AI proposes a plan (spaces → lists → tasks + docs); the user
 *                 sees exactly what will be created and can drop items before
 *                 building. Nothing is written yet.
 *   3. done     — the plan is executed through the real create APIs (RLS,
 *                 role limits, plan caps all still apply) and the created
 *                 items are shown with links.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icons } from "@/components/icons";
import { useHierarchy } from "@/components/HierarchyProvider";
import {
  aiApi,
  ApiError,
  type AiBuildPlan,
  type AiBuildResult,
  type AiPlanSpace,
} from "@/lib/api";

type Stage = "prompt" | "loading" | "preview" | "building" | "done";

const EXAMPLES = [
  "Plan a Q3 product launch with marketing, design and dev workstreams",
  "Set up a content calendar space with a blog pipeline and 6 article ideas",
  "Onboarding plan for a new engineer — first week, first month tasks",
  "Client project for Acme Corp: kickoff, delivery and review lists",
];

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export function BuildWithAi({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { reload } = useHierarchy();
  const [stage, setStage] = useState<Stage>("prompt");
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<AiBuildPlan | null>(null);
  const [source, setSource] = useState<"claude" | "heuristic">("claude");
  const [result, setResult] = useState<AiBuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the modal opens.
  useEffect(() => {
    if (open) {
      setStage("prompt");
      setPrompt("");
      setPlan(null);
      setResult(null);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const generate = async () => {
    const brief = prompt.trim();
    if (!brief) return;
    setStage("loading");
    setError(null);
    try {
      const r = await aiApi.buildPlan(brief);
      setPlan(r.plan);
      setSource(r.source);
      setStage("preview");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't generate a plan. Try again.");
      setStage("prompt");
    }
  };

  const build = async () => {
    if (!plan) return;
    setStage("building");
    setError(null);
    try {
      const r = await aiApi.build(plan);
      setResult(r);
      setStage("done");
      void reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't build the plan. Try again.");
      setStage("preview");
    }
  };

  /** Drop a space from the plan before building. */
  const dropSpace = (i: number) => {
    if (!plan) return;
    const spaces = plan.spaces.filter((_, idx) => idx !== i);
    setPlan({ ...plan, spaces });
  };

  const planCounts = plan
    ? plan.spaces.reduce(
        (acc, s) => {
          acc.spaces++;
          acc.lists += s.lists?.length ?? 0;
          acc.tasks += (s.lists ?? []).reduce((n, l) => n + (l.tasks?.length ?? 0), 0);
          acc.docs += s.docs?.length ?? 0;
          return acc;
        },
        { spaces: 0, lists: 0, tasks: 0, docs: 0 },
      )
    : null;

  const goto = (url: string) => {
    onClose();
    router.push(url);
  };

  return (
    <div className="aib-scrim" onClick={onClose}>
      <div
        className="aib"
        role="dialog"
        aria-modal="true"
        aria-label="Build with AI"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="aib-head">
          <span className="aib-head-title">
            <span className="aib-spark">{Icons.sparkles}</span>
            Build with AI
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            {Icons.close}
          </button>
        </header>

        {/* Step 1 — prompt */}
        {(stage === "prompt" || stage === "loading") && (
          <div className="aib-body">
            <p className="aib-lead">
              Describe what you want to set up. AI drafts the spaces, lists,
              tasks and docs — you review before anything is created.
            </p>
            <textarea
              className="aib-input"
              placeholder="e.g. Plan a product launch for Q3 with marketing, design and dev workstreams and starter tasks in each"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
              }}
              autoFocus
              rows={4}
              disabled={stage === "loading"}
            />
            <div className="aib-examples">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="aib-chip"
                  onClick={() => setPrompt(ex)}
                  disabled={stage === "loading"}
                >
                  {ex}
                </button>
              ))}
            </div>
            {error && <div className="aib-error">{error}</div>}
            <div className="aib-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={generate}
                disabled={!prompt.trim() || stage === "loading"}
              >
                {stage === "loading" ? (
                  <>
                    <span className="aib-spin" aria-hidden="true" /> Drafting…
                  </>
                ) : (
                  <>
                    {Icons.sparkles} Generate plan
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — preview */}
        {(stage === "preview" || stage === "building") && plan && (
          <div className="aib-body">
            <div className="aib-summary">
              <div className="aib-summary-text">{plan.summary}</div>
              {source === "heuristic" && (
                <span className="aib-badge" title="Generated without an AI key — a starter structure.">
                  Starter
                </span>
              )}
            </div>
            {planCounts && (
              <div className="aib-counts">
                <span>{planCounts.spaces} space{planCounts.spaces !== 1 ? "s" : ""}</span>
                <span>·</span>
                <span>{planCounts.lists} list{planCounts.lists !== 1 ? "s" : ""}</span>
                <span>·</span>
                <span>{planCounts.tasks} task{planCounts.tasks !== 1 ? "s" : ""}</span>
                {planCounts.docs > 0 && (
                  <>
                    <span>·</span>
                    <span>{planCounts.docs} doc{planCounts.docs !== 1 ? "s" : ""}</span>
                  </>
                )}
              </div>
            )}

            <div className="aib-preview">
              {plan.spaces.map((s, i) => (
                <PlanSpaceCard key={i} space={s} onDrop={() => dropSpace(i)} />
              ))}
              {plan.spaces.length === 0 && (
                <div className="aib-empty">
                  Nothing left to build. Regenerate or start over.
                </div>
              )}
            </div>

            {error && <div className="aib-error">{error}</div>}
            <div className="aib-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setStage("prompt")}
                disabled={stage === "building"}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={build}
                disabled={stage === "building" || plan.spaces.length === 0}
              >
                {stage === "building" ? (
                  <>
                    <span className="aib-spin" aria-hidden="true" /> Building…
                  </>
                ) : (
                  <>Build it{Icons.arrowRight}</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — done */}
        {stage === "done" && result && (
          <div className="aib-body">
            <div className="aib-done-head">
              <span className="aib-done-ic">{Icons.check}</span>
              <div>
                <div className="aib-done-title">Built ✨</div>
                <div className="aib-counts">
                  <span>{result.counts.spaces} space{result.counts.spaces !== 1 ? "s" : ""}</span>
                  <span>·</span>
                  <span>{result.counts.lists} list{result.counts.lists !== 1 ? "s" : ""}</span>
                  <span>·</span>
                  <span>{result.counts.tasks} task{result.counts.tasks !== 1 ? "s" : ""}</span>
                  {result.counts.docs > 0 && (
                    <>
                      <span>·</span>
                      <span>{result.counts.docs} doc{result.counts.docs !== 1 ? "s" : ""}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="aib-links">
              {result.spaces.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="aib-link"
                  onClick={() => goto(s.url)}
                >
                  <span className="aib-link-ic">{Icons.spaces}</span>
                  <span className="aib-link-name">{s.name}</span>
                  {Icons.arrowRight}
                </button>
              ))}
            </div>

            <div className="aib-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setStage("prompt");
                  setPrompt("");
                  setPlan(null);
                  setResult(null);
                }}
              >
                Build another
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  result.spaces[0] ? goto(result.spaces[0].url) : onClose()
                }
              >
                {result.spaces[0] ? "Open space" : "Done"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanSpaceCard({
  space,
  onDrop,
}: {
  space: AiPlanSpace;
  onDrop: () => void;
}) {
  const [open, setOpen] = useState(true);
  const taskCount = (space.lists ?? []).reduce(
    (n, l) => n + (l.tasks?.length ?? 0),
    0,
  );
  return (
    <div className="aib-space">
      <div className="aib-space-head">
        <button
          type="button"
          className="aib-space-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="aib-space-emoji">{space.icon || "📁"}</span>
          <span className="aib-space-name">{space.name}</span>
          <span className="aib-space-meta">
            {space.lists?.length ?? 0} lists · {taskCount} tasks
            {space.docs && space.docs.length > 0 ? ` · ${space.docs.length} docs` : ""}
          </span>
        </button>
        <button
          type="button"
          className="aib-drop"
          onClick={onDrop}
          aria-label={`Remove ${space.name}`}
          title="Remove from plan"
        >
          {Icons.close}
        </button>
      </div>
      {open && (
        <div className="aib-space-body">
          {(space.lists ?? []).map((l, li) => (
            <div key={li} className="aib-list">
              <div className="aib-list-name">
                <span className="aib-list-ic">{Icons.list}</span>
                {l.name}
              </div>
              <div className="aib-tasks">
                {(l.tasks ?? []).map((t, ti) => (
                  <div key={ti} className="aib-task">
                    <span className="aib-task-dot" />
                    <span className="aib-task-name">{t.name}</span>
                    {t.priority && (
                      <span className={`aib-pri aib-pri-${t.priority}`}>
                        {PRIORITY_LABEL[t.priority]}
                      </span>
                    )}
                    {typeof t.dueInDays === "number" && (
                      <span className="aib-due">
                        {t.dueInDays === 0 ? "today" : `${t.dueInDays}d`}
                      </span>
                    )}
                  </div>
                ))}
                {(l.tasks?.length ?? 0) === 0 && (
                  <div className="aib-task muted">No tasks</div>
                )}
              </div>
            </div>
          ))}
          {(space.docs ?? []).map((d, di) => (
            <div key={`doc-${di}`} className="aib-list">
              <div className="aib-list-name">
                <span className="aib-list-ic">{Icons.docs}</span>
                {d.icon ? `${d.icon} ` : ""}
                {d.name}
                <span className="aib-doc-tag">Doc</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
