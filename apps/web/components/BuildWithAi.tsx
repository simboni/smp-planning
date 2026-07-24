"use client";

/**
 * AI Builder (Module 15) — one sentence → real StackUp work.
 *
 * Two modes:
 *   • Build  — spaces / lists / tasks (+ docs). The planner is workspace-aware:
 *     it proposes WHERE each group of tasks should go (an existing list, a new
 *     list in an existing space, or a brand-new space) and flags anything it's
 *     unsure about so you confirm the destination before building.
 *   • Form   — drafts an intake form (fields + options) and creates it into a
 *     list you choose or create.
 *
 * Nothing is written until you press Build/Create — the preview is fully
 * editable (retarget destinations, drop items).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icons } from "@/components/icons";
import { useHierarchy } from "@/components/HierarchyProvider";
import { copyToClipboard, publicFormUrl } from "@/lib/format";
import { SharePreviewCard } from "@/components/SharePreviewCard";
import {
  aiApi,
  ApiError,
  FORM_FIELD_TYPE_LABEL,
  type AiAskAnswer,
  type AiDoResult,
  type AiOperation,
  type AiOperationPlan,
  type AiBuilderContext,
  type AiBuildPlan,
  type AiBuildResult,
  type AiFormPlan,
  type AiListRef,
  type AiPlanTarget,
  type AiSpaceRef,
} from "@/lib/api";

type Mode = "ask" | "do" | "build" | "form";
type Stage = "prompt" | "loading" | "preview" | "building" | "done";

export type CopilotMode = Mode;

/**
 * Open the Copilot modal from anywhere in the app, optionally landing on a
 * specific mode ("build" for spaces/lists/tasks, "form" for forms). AppShell
 * owns the modal and listens for this event.
 */
export function openCopilot(mode?: CopilotMode): void {
  window.dispatchEvent(
    new CustomEvent("stackup:build-with-ai", { detail: { mode } }),
  );
}

/**
 * The "or build with Copilot" affordance shown inside traditional create
 * flows (new space / folder / list / task / form), so every creation entry
 * point offers the choice: continue by hand, or describe it and let Copilot
 * draft it. `onBefore` lets the caller close its own modal / cancel its
 * inline input first. Uses onMouseDown-preventDefault so clicking it never
 * blurs (and thereby commits) an adjacent inline-create input.
 */
export function CopilotOption({
  mode,
  label,
  hint,
  compact,
  indent,
  onBefore,
}: {
  mode: CopilotMode;
  label?: string;
  hint?: string;
  /** Small single-line variant for the sidebar tree. */
  compact?: boolean;
  /** Left padding (px) so the compact variant aligns with tree rows. */
  indent?: number;
  onBefore?: () => void;
}) {
  const open = (): void => {
    onBefore?.();
    openCopilot(mode);
  };
  if (compact) {
    return (
      <button
        type="button"
        className="copilot-opt copilot-opt-compact"
        style={indent !== undefined ? { paddingLeft: indent } : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={open}
      >
        <span className="copilot-opt-ic">{Icons.sparkles}</span>
        {label ?? "Build with Copilot"}
      </button>
    );
  }
  return (
    <div className="copilot-opt-row">
      <span className="copilot-opt-or">or</span>
      <button
        type="button"
        className="copilot-opt"
        onMouseDown={(e) => e.preventDefault()}
        onClick={open}
      >
        <span className="copilot-opt-ic">{Icons.sparkles}</span>
        <span className="copilot-opt-body">
          <span className="copilot-opt-label">{label ?? "Build with Copilot"}</span>
          {hint && <span className="copilot-opt-hint">{hint}</span>}
        </span>
      </button>
    </div>
  );
}

const NEW = "__new__";
const DRAFT_KEY = "stackup.copilot.draft";

/** Persist / restore the in-progress prompt so a stray refresh never loses it. */
function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveDraft(text: string): void {
  try {
    if (text.trim()) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* private mode — ignore */
  }
}

/** Editable destination for one target (or the form). */
interface Dest {
  spaceMode: "existing" | "new" | "";
  spaceId: string;
  newSpaceName: string;
  newSpaceIcon?: string;
  listMode: "existing" | "new";
  listId: string;
  newListName: string;
  /** For a new list in an existing space: an optional folder to nest it in. */
  folderId: string;
}

const ASK_EXAMPLES = [
  "How's this week going?",
  "Which tasks are overdue and who owns them?",
  "What spaces and projects do we have?",
];
const DO_EXAMPLES = [
  "Reassign overdue tasks to whoever has capacity",
  "Move my in-progress tasks to Done and comment a summary",
  "Set the launch tasks to high priority and post a recap in #general",
];
const BUILD_EXAMPLES = [
  "Add 5 tasks to my Marketing list for the Q3 launch",
  "Plan a product launch with marketing, design and dev workstreams",
  "Onboarding plan for a new engineer — first week and first month",
];
const FORM_EXAMPLES = [
  "Feedback form about project/task management apps",
  "Bug report form: title, severity, steps, email",
  "Event RSVP: name, email, attending, dietary needs",
];

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

const OP_LABEL: Record<string, string> = {
  create_task: "New task",
  set_status: "Status",
  set_assignees: "Assign",
  set_priority: "Priority",
  set_due: "Due date",
  add_comment: "Comment",
  post_message: "Message",
  move_task: "Move task",
  move_list: "Move list",
  move_folder: "Move folder",
};

/** Build an initial Dest from a plan target + context. */
function destFromTarget(t: AiPlanTarget): Dest {
  const spaceExisting = "existingId" in t.space;
  const listExisting = "existingId" in t.list;
  return {
    // Reflect the AI's proposed destination even when it flags needsChoice —
    // the card is highlighted for confirmation, but the picker is pre-filled so
    // the user confirms rather than re-picking from a blank.
    spaceMode: spaceExisting ? "existing" : "new",
    spaceId: spaceExisting ? (t.space as { existingId: string }).existingId : "",
    newSpaceName: !spaceExisting ? (t.space as { name: string }).name : "",
    newSpaceIcon: !spaceExisting ? (t.space as { icon?: string }).icon : undefined,
    listMode: listExisting ? "existing" : "new",
    listId: listExisting ? (t.list as { existingId: string }).existingId : "",
    newListName: !listExisting ? (t.list as { name: string }).name : "",
    folderId:
      !listExisting ? ((t.list as { folderId?: string }).folderId ?? "") : "",
  };
}

function destResolved(d: Dest): boolean {
  if (d.spaceMode === "") return false;
  if (d.spaceMode === "existing" && !d.spaceId) return false;
  if (d.spaceMode === "new" && !d.newSpaceName.trim()) return false;
  // A new space forces a new list.
  if (d.spaceMode === "new") return !!d.newListName.trim();
  if (d.listMode === "existing") return !!d.listId;
  return !!d.newListName.trim();
}

function destToRefs(d: Dest): { space: AiSpaceRef; list: AiListRef } {
  const space: AiSpaceRef =
    d.spaceMode === "existing"
      ? { existingId: d.spaceId }
      : { create: true, name: d.newSpaceName.trim(), icon: d.newSpaceIcon };
  const list: AiListRef =
    d.spaceMode === "existing" && d.listMode === "existing"
      ? { existingId: d.listId }
      : {
          create: true,
          name: d.newListName.trim() || "Tasks",
          // Folders only apply to a new list inside an EXISTING space.
          ...(d.spaceMode === "existing" && d.folderId
            ? { folderId: d.folderId }
            : {}),
        };
  return { space, list };
}

export function BuildWithAi({
  open,
  onClose,
  initialMode,
}: {
  open: boolean;
  onClose: () => void;
  /** Mode to land on when opened (defaults to "ask"). */
  initialMode?: CopilotMode;
}) {
  const router = useRouter();
  const { reload } = useHierarchy();
  const [mode, setMode] = useState<Mode>("ask");
  const [stage, setStage] = useState<Stage>("prompt");
  const [prompt, setPrompt] = useState("");
  const [source, setSource] = useState<"claude" | "heuristic">("claude");
  const [error, setError] = useState<string | null>(null);

  // Ask mode
  const [answer, setAnswer] = useState<AiAskAnswer | null>(null);

  // Do mode
  const [opPlan, setOpPlan] = useState<AiOperationPlan | null>(null);
  const [opOn, setOpOn] = useState<boolean[]>([]);
  const [doResult, setDoResult] = useState<AiDoResult | null>(null);

  // Build mode
  const [plan, setPlan] = useState<AiBuildPlan | null>(null);
  const [context, setContext] = useState<AiBuilderContext>({ spaces: [], members: [] });
  const [dests, setDests] = useState<Dest[]>([]);
  const [result, setResult] = useState<AiBuildResult | null>(null);

  // Form mode
  const [formPlan, setFormPlan] = useState<AiFormPlan | null>(null);
  const [formDest, setFormDest] = useState<Dest | null>(null);
  const [formResult, setFormResult] = useState<{
    formId: string;
    listUrl: string;
    publicToken: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setMode(initialMode ?? "ask");
      setStage("prompt");
      // Restore any instruction the user was mid-typing (survives a refresh).
      setPrompt(loadDraft());
      setAnswer(null);
      setOpPlan(null);
      setOpOn([]);
      setDoResult(null);
      setPlan(null);
      setDests([]);
      setResult(null);
      setFormPlan(null);
      setFormDest(null);
      setFormResult(null);
      setError(null);
    }
  }, [open, initialMode]);

  // Keep the draft persisted while the prompt is open so a refresh can't lose it.
  useEffect(() => {
    if (open && stage === "prompt") saveDraft(prompt);
  }, [prompt, open, stage]);

  if (!open) return null;

  const examples =
    mode === "ask"
      ? ASK_EXAMPLES
      : mode === "do"
        ? DO_EXAMPLES
        : mode === "build"
          ? BUILD_EXAMPLES
          : FORM_EXAMPLES;

  const generate = async () => {
    const brief = prompt.trim();
    if (!brief) return;
    setStage("loading");
    setError(null);
    // The instruction has been submitted — it's safe to drop the saved draft.
    saveDraft("");
    try {
      if (mode === "ask") {
        const r = await aiApi.ask(brief);
        setAnswer(r);
        setSource(r.source);
        setStage("preview");
      } else if (mode === "do") {
        const r = await aiApi.doPlan(brief);
        setOpPlan(r);
        setOpOn(r.operations.map(() => true));
        setSource(r.source);
        setStage("preview");
      } else if (mode === "build") {
        const r = await aiApi.buildPlan(brief);
        setPlan(r.plan);
        setContext(r.context);
        setSource(r.source);
        setDests(r.plan.targets.map(destFromTarget));
        setStage("preview");
      } else {
        // Fetch the workspace context alongside the plan so the destination
        // picker can offer existing spaces/lists — not just "create new".
        const [r, ctx] = await Promise.all([
          aiApi.formPlan(brief),
          aiApi.buildContext(),
        ]);
        setFormPlan(r.form);
        setContext(ctx);
        setSource(r.source);
        // Default the destination to the user's first existing space (and its
        // first list) when they have one, so selection is the default path;
        // fall back to creating a new "Feedback" space only for empty
        // workspaces. Either way the user can retarget in the picker.
        const firstSpace = ctx.spaces[0];
        setFormDest(
          firstSpace
            ? {
                spaceMode: "existing",
                spaceId: firstSpace.id,
                newSpaceName: "",
                newSpaceIcon: "🗂️",
                listMode: firstSpace.lists[0] ? "existing" : "new",
                listId: firstSpace.lists[0]?.id ?? "",
                newListName: r.form.name,
                folderId: "",
              }
            : {
                spaceMode: "new",
                spaceId: "",
                newSpaceName: "Feedback",
                newSpaceIcon: "🗂️",
                listMode: "new",
                listId: "",
                newListName: r.form.name,
                folderId: "",
              },
        );
        setStage("preview");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't generate. Try again.");
      setStage("prompt");
    }
  };

  const build = async () => {
    if (!plan) return;
    setStage("building");
    setError(null);
    try {
      const targets = plan.targets.map((t, i) => {
        const { space, list } = destToRefs(dests[i]);
        return { ...t, space, list };
      });
      const r = await aiApi.build({ summary: plan.summary, targets });
      setResult(r);
      setStage("done");
      void reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't build. Try again.");
      setStage("preview");
    }
  };

  const applyOps = async () => {
    if (!opPlan) return;
    const chosen = opPlan.operations.filter((_, i) => opOn[i]);
    if (chosen.length === 0) return;
    setStage("building");
    setError(null);
    try {
      const r = await aiApi.do(chosen);
      setDoResult(r);
      setStage("done");
      void reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't apply. Try again.");
      setStage("preview");
    }
  };

  const createForm = async () => {
    if (!formPlan || !formDest) return;
    setStage("building");
    setError(null);
    try {
      const { space, list } = destToRefs(formDest);
      const r = await aiApi.buildForm(formPlan, space, list);
      setFormResult({ formId: r.formId, listUrl: r.listUrl, publicToken: r.publicToken });
      setStage("done");
      void reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create the form. Try again.");
      setStage("preview");
    }
  };

  const dropTarget = (i: number) => {
    if (!plan) return;
    setPlan({ ...plan, targets: plan.targets.filter((_, idx) => idx !== i) });
    setDests(dests.filter((_, idx) => idx !== i));
  };

  const setDest = (i: number, patch: Partial<Dest>) =>
    setDests((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const setTaskAssignees = (ti: number, taskIdx: number, ids: string[]) => {
    if (!plan) return;
    setPlan({
      ...plan,
      targets: plan.targets.map((t, i) =>
        i !== ti
          ? t
          : {
              ...t,
              tasks: t.tasks.map((tk, k) =>
                k !== taskIdx
                  ? tk
                  : { ...tk, assigneeIds: ids.length ? ids : undefined },
              ),
            },
      ),
    });
  };

  const allResolved =
    mode === "build"
      ? dests.length > 0 && dests.every(destResolved)
      : mode === "form"
        ? !!formDest && destResolved(formDest)
        : true;

  const goto = (url: string) => {
    onClose();
    router.push(url);
  };

  const planCounts = plan
    ? plan.targets.reduce(
        (a, t) => ({ tasks: a.tasks + (t.tasks?.length ?? 0), targets: a.targets + 1 }),
        { tasks: 0, targets: 0 },
      )
    : null;

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
            StackUp Copilot
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            {Icons.close}
          </button>
        </header>

        {/* Step 1 — prompt */}
        {(stage === "prompt" || stage === "loading") && (
          <div className="aib-body">
            <div className="aib-modes">
              <button
                type="button"
                className={`aib-mode${mode === "ask" ? " on" : ""}`}
                onClick={() => setMode("ask")}
                disabled={stage === "loading"}
              >
                {Icons.sparkles} Ask
              </button>
              <button
                type="button"
                className={`aib-mode${mode === "do" ? " on" : ""}`}
                onClick={() => setMode("do")}
                disabled={stage === "loading"}
              >
                {Icons.bolt} Do
              </button>
              <button
                type="button"
                className={`aib-mode${mode === "build" ? " on" : ""}`}
                onClick={() => setMode("build")}
                disabled={stage === "loading"}
              >
                {Icons.spaces} Spaces & tasks
              </button>
              <button
                type="button"
                className={`aib-mode${mode === "form" ? " on" : ""}`}
                onClick={() => setMode("form")}
                disabled={stage === "loading"}
              >
                {Icons.clipboard} Form
              </button>
            </div>
            <p className="aib-lead">
              {mode === "ask"
                ? "Ask anything about your workspace — Copilot answers from your real tasks, docs and people, and links to the source."
                : mode === "do"
                  ? "Tell Copilot what to do — reassign, reprioritize, update status, comment, post a recap. It previews every action before touching anything."
                  : mode === "build"
                    ? "Describe the work. AI drafts the tasks and figures out where they belong — you confirm the destination before anything is created."
                    : "Describe the form. AI drafts the questions; you pick the list it collects into."}
            </p>
            <textarea
              className="aib-input"
              placeholder={
                mode === "ask"
                  ? "e.g. How's this week going?"
                  : mode === "do"
                    ? "e.g. Reassign overdue tasks to whoever has capacity"
                    : mode === "build"
                      ? "e.g. Add tasks to my Marketing list for the Q3 launch"
                      : "e.g. Feedback form about project management apps"
              }
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
              {examples.map((ex) => (
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
                    <span className="aib-spin" aria-hidden="true" />{" "}
                    {mode === "ask" ? "Thinking…" : mode === "do" ? "Planning…" : "Drafting…"}
                  </>
                ) : (
                  <>
                    {Icons.sparkles}{" "}
                    {mode === "ask" ? "Ask" : mode === "do" ? "Plan actions" : "Generate"}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — answer (ASK) */}
        {stage === "preview" && mode === "ask" && answer && (
          <div className="aib-body">
            {source === "heuristic" && (
              <div className="aib-summary" style={{ marginBottom: 10 }}>
                <span className="aib-badge" title="AI key not configured — showing matching items only.">
                  Search only
                </span>
              </div>
            )}
            <div className="ask-answer">{answer.answer}</div>
            {answer.sources.length > 0 && (
              <div className="ask-sources">
                <div className="ask-sources-h">Sources</div>
                <div className="ask-source-chips">
                  {answer.sources.map((s) => (
                    <button
                      key={s.ref}
                      type="button"
                      className="ask-source"
                      onClick={() => goto(s.url)}
                      title={`Open ${s.type}`}
                    >
                      <span className="ask-source-type">{s.type}</span>
                      <span className="ask-source-title">{s.title}</span>
                      {Icons.arrowRight}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="aib-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setStage("prompt");
                  setPrompt("");
                  setAnswer(null);
                }}
              >
                Ask another
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — preview (DO) */}
        {(stage === "preview" || stage === "building") && mode === "do" && opPlan && (
          <div className="aib-body">
            <div className="aib-summary">
              <div className="aib-summary-text">{opPlan.summary}</div>
              {source === "heuristic" && (
                <span className="aib-badge" title="AI key not configured.">
                  Needs AI key
                </span>
              )}
            </div>

            {opPlan.operations.length === 0 ? (
              <div className="aib-empty">
                No actions to take. Try rephrasing, or use Ask to explore first.
              </div>
            ) : (
              <>
                <div className="aib-counts">
                  <span>
                    {opOn.filter(Boolean).length} of {opPlan.operations.length} selected
                  </span>
                </div>
                <div className="do-ops">
                  {opPlan.operations.map((op, i) => (
                    <label key={i} className={`do-op${opOn[i] ? "" : " off"}`}>
                      <input
                        type="checkbox"
                        checked={opOn[i]}
                        onChange={() =>
                          setOpOn((v) => v.map((x, k) => (k === i ? !x : x)))
                        }
                      />
                      <span className="do-op-body">
                        <span className="do-op-top">
                          <span className={`do-op-tag do-op-${op.type}`}>
                            {OP_LABEL[op.type]}
                          </span>
                          <span className="do-op-summary">{op.summary}</span>
                        </span>
                        {op.reason && <span className="do-op-reason">{op.reason}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}

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
                onClick={applyOps}
                disabled={stage === "building" || opOn.filter(Boolean).length === 0}
              >
                {stage === "building" ? (
                  <>
                    <span className="aib-spin" aria-hidden="true" /> Applying…
                  </>
                ) : (
                  <>
                    Apply {opOn.filter(Boolean).length} action
                    {opOn.filter(Boolean).length !== 1 ? "s" : ""}
                    {Icons.arrowRight}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — done (DO) */}
        {stage === "done" && mode === "do" && doResult && (
          <div className="aib-body">
            <div className="aib-done-head">
              <span className="aib-done-ic">{Icons.check}</span>
              <div>
                <div className="aib-done-title">
                  Applied {doResult.applied} action{doResult.applied !== 1 ? "s" : ""} ✨
                </div>
              </div>
            </div>
            <div className="do-results">
              {doResult.results.map((r, i) => (
                <div key={i} className={`do-result${r.ok ? "" : " fail"}`}>
                  <span className="do-result-ic">{r.ok ? Icons.check : Icons.close}</span>
                  <span className="do-result-text">{r.summary}</span>
                  {!r.ok && <span className="do-result-detail">{r.detail}</span>}
                </div>
              ))}
            </div>
            <div className="aib-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setStage("prompt");
                  setPrompt("");
                  setOpPlan(null);
                  setDoResult(null);
                }}
              >
                Do another
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — preview (BUILD) */}
        {(stage === "preview" || stage === "building") && mode === "build" && plan && (
          <div className="aib-body">
            <div className="aib-summary">
              <div className="aib-summary-text">{plan.summary}</div>
              {source === "heuristic" && (
                <span className="aib-badge" title="Generated without an AI key — a starter draft.">
                  Starter
                </span>
              )}
            </div>
            {planCounts && (
              <div className="aib-counts">
                <span>{planCounts.targets} destination{planCounts.targets !== 1 ? "s" : ""}</span>
                <span>·</span>
                <span>{planCounts.tasks} task{planCounts.tasks !== 1 ? "s" : ""}</span>
              </div>
            )}

            <div className="aib-preview">
              {plan.targets.map((t, i) => (
                <TargetCard
                  key={i}
                  target={t}
                  dest={dests[i]}
                  context={context}
                  onDest={(patch) => setDest(i, patch)}
                  onAssignees={(taskIdx, ids) => setTaskAssignees(i, taskIdx, ids)}
                  onDrop={() => dropTarget(i)}
                />
              ))}
              {plan.targets.length === 0 && (
                <div className="aib-empty">Nothing left to build. Start over.</div>
              )}
            </div>

            {error && <div className="aib-error">{error}</div>}
            {!allResolved && plan.targets.length > 0 && (
              <div className="aib-hint">{Icons.info} Choose a destination for each group to continue.</div>
            )}
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
                disabled={stage === "building" || !allResolved}
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

        {/* Step 2 — preview (FORM) */}
        {(stage === "preview" || stage === "building") && mode === "form" && formPlan && formDest && (
          <div className="aib-body">
            <div className="aib-summary">
              <div className="aib-summary-text">{formPlan.name}</div>
              {source === "heuristic" && <span className="aib-badge">Starter</span>}
            </div>
            {formPlan.description && (
              <p className="aib-form-desc muted">{formPlan.description}</p>
            )}

            <div className="aib-form-fields">
              {formPlan.fields.map((f, i) => (
                <div key={i} className="aib-field">
                  <span className="aib-field-num">{i + 1}</span>
                  <div className="aib-field-body">
                    <div className="aib-field-label">
                      {f.label}
                      {f.required && <span className="aib-req">required</span>}
                      {f.asTitle && <span className="aib-title-tag">Title</span>}
                    </div>
                    <div className="aib-field-meta">
                      {FORM_FIELD_TYPE_LABEL[f.type]}
                      {f.options && f.options.length > 0 && (
                        <span className="aib-field-opts">
                          {" · "}
                          {f.options.join(" · ")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="aib-dest-block">
              <div className="aib-dest-h">Collect responses into</div>
              <DestPicker context={context} dest={formDest} onDest={(p) => setFormDest({ ...formDest, ...p })} />
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
                onClick={createForm}
                disabled={stage === "building" || !allResolved}
              >
                {stage === "building" ? (
                  <>
                    <span className="aib-spin" aria-hidden="true" /> Creating…
                  </>
                ) : (
                  <>Create form{Icons.arrowRight}</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — done */}
        {stage === "done" && mode !== "do" && (
          <div className="aib-body">
            <div className="aib-done-head">
              <span className="aib-done-ic">{Icons.check}</span>
              <div>
                <div className="aib-done-title">{mode === "form" ? "Form created ✨" : "Built ✨"}</div>
                {result && (
                  <div className="aib-counts">
                    {result.counts.spacesCreated > 0 && (
                      <span>{result.counts.spacesCreated} new space{result.counts.spacesCreated !== 1 ? "s" : ""}</span>
                    )}
                    {result.counts.listsCreated > 0 && (
                      <>
                        {result.counts.spacesCreated > 0 && <span>·</span>}
                        <span>{result.counts.listsCreated} new list{result.counts.listsCreated !== 1 ? "s" : ""}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{result.counts.tasks} task{result.counts.tasks !== 1 ? "s" : ""}</span>
                    {result.counts.docs > 0 && (
                      <>
                        <span>·</span>
                        <span>{result.counts.docs} doc{result.counts.docs !== 1 ? "s" : ""}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {mode === "form" && formResult && (
              <>
                {formPlan && (
                  <div className="aib-share-preview">
                    <SharePreviewCard
                      kind="form"
                      name={formPlan.name}
                      summary={`${formPlan.fields.length} question${formPlan.fields.length !== 1 ? "s" : ""}`}
                      access="Anyone with the link · can submit a response"
                    />
                  </div>
                )}
                <div className="aib-share">
                  <div className="aib-share-h">Share this form to collect responses</div>
                  <div className="aib-share-row">
                    <input
                      className="aib-share-url"
                      readOnly
                      value={publicFormUrl(formResult.publicToken)}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        const ok = await copyToClipboard(publicFormUrl(formResult.publicToken));
                        if (ok) {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1600);
                        }
                      }}
                    >
                      {copied ? "Copied ✓" : "Copy link"}
                    </button>
                  </div>
                  <p className="aib-share-hint muted">
                    Anyone with this link can fill out the form — no account needed.
                  </p>
                </div>
                <div className="aib-links">
                  <a
                    className="aib-link"
                    href={publicFormUrl(formResult.publicToken)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="aib-link-ic">{Icons.eye}</span>
                    <span className="aib-link-name">Preview the live form</span>
                    {Icons.arrowRight}
                  </a>
                  <button
                    type="button"
                    className="aib-link"
                    onClick={() => goto(`/form-builder?id=${formResult.formId}`)}
                  >
                    <span className="aib-link-ic">{Icons.edit}</span>
                    <span className="aib-link-name">Open form in the builder</span>
                    {Icons.arrowRight}
                  </button>
                  <button type="button" className="aib-link" onClick={() => goto("/forms")}>
                    <span className="aib-link-ic">{Icons.docs}</span>
                    <span className="aib-link-name">Manage forms &amp; view responses</span>
                    {Icons.arrowRight}
                  </button>
                </div>
              </>
            )}

            {result && result.spaces.filter((s) => s.created).length > 0 && (
              <div className="aib-links">
                {result.spaces
                  .filter((s) => s.created)
                  .map((s) => (
                    <button key={s.id} type="button" className="aib-link" onClick={() => goto(s.url)}>
                      <span className="aib-link-ic">{Icons.spaces}</span>
                      <span className="aib-link-name">{s.name}</span>
                      {Icons.arrowRight}
                    </button>
                  ))}
              </div>
            )}

            <div className="aib-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setStage("prompt");
                  setPrompt("");
                  setPlan(null);
                  setResult(null);
                  setFormPlan(null);
                  setFormResult(null);
                }}
              >
                Build another
              </button>
              {mode === "form" && formResult ? (
                <button type="button" className="btn btn-primary" onClick={() => goto(formResult.listUrl)}>
                  Open list
                </button>
              ) : result && result.spaces[0] ? (
                <button type="button" className="btn btn-primary" onClick={() => goto(result.spaces[0].url)}>
                  Open space
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={onClose}>
                  Done
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Destination picker ------------------------------------------- */

function DestPicker({
  context,
  dest,
  onDest,
}: {
  context: AiBuilderContext;
  dest: Dest;
  onDest: (patch: Partial<Dest>) => void;
}) {
  const space = context.spaces.find((s) => s.id === dest.spaceId);
  const spaceValue = dest.spaceMode === "existing" ? dest.spaceId : dest.spaceMode === "new" ? NEW : "";

  return (
    <div className="aib-dest">
      {/* Space row */}
      <div className="aib-dest-row">
        <span className="aib-dest-tag">Space</span>
        <select
          className="aib-dest-select"
          value={spaceValue}
          onChange={(e) => {
            const v = e.target.value;
            // Always clear folderId on a space change — a folder from the old
            // space must never carry over to a different (or new) space.
            if (v === NEW) onDest({ spaceMode: "new", listMode: "new", folderId: "" });
            else if (v === "") onDest({ spaceMode: "", folderId: "" });
            else
              onDest({
                spaceMode: "existing",
                spaceId: v,
                listMode: "existing",
                listId: "",
                folderId: "",
              });
          }}
        >
          <option value="">— Choose space —</option>
          {context.spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value={NEW}>＋ New space…</option>
        </select>
        {dest.spaceMode === "new" && (
          <input
            className="aib-dest-input"
            placeholder="New space name"
            value={dest.newSpaceName}
            onChange={(e) => onDest({ newSpaceName: e.target.value })}
          />
        )}
      </div>

      {/* List row */}
      <div className="aib-dest-row">
        <span className="aib-dest-tag">List</span>
        {dest.spaceMode === "existing" ? (
          <>
            <select
              className="aib-dest-select"
              value={dest.listMode === "new" ? NEW : dest.listId}
              onChange={(e) => {
                const v = e.target.value;
                if (v === NEW) onDest({ listMode: "new" });
                else onDest({ listMode: "existing", listId: v });
              }}
            >
              <option value="">— Choose list —</option>
              {(space?.lists ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value={NEW}>＋ New list…</option>
            </select>
            {dest.listMode === "new" && (
              <input
                className="aib-dest-input"
                placeholder="New list name"
                value={dest.newListName}
                onChange={(e) => onDest({ newListName: e.target.value })}
              />
            )}
            {dest.listMode === "new" && space && space.folders.length > 0 && (
              <select
                className="aib-dest-select"
                value={dest.folderId}
                onChange={(e) => onDest({ folderId: e.target.value })}
                title="Folder (optional)"
              >
                <option value="">No folder</option>
                {space.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    📁 {f.name}
                  </option>
                ))}
              </select>
            )}
          </>
        ) : dest.spaceMode === "new" ? (
          <input
            className="aib-dest-input"
            placeholder="New list name"
            value={dest.newListName}
            onChange={(e) => onDest({ newListName: e.target.value })}
          />
        ) : (
          <span className="aib-dest-hint muted">Pick a space first</span>
        )}
      </div>
    </div>
  );
}

function TargetCard({
  target,
  dest,
  context,
  onDest,
  onAssignees,
  onDrop,
}: {
  target: AiPlanTarget;
  dest: Dest;
  context: AiBuilderContext;
  onDest: (patch: Partial<Dest>) => void;
  onAssignees: (taskIndex: number, ids: string[]) => void;
  onDrop: () => void;
}) {
  const [open, setOpen] = useState(true);
  const unresolved = !destResolved(dest);
  const memberName = useMemo(
    () => new Map(context.members.map((m) => [m.id, m.name])),
    [context.members],
  );
  return (
    <div className={`aib-space${target.needsChoice && unresolved ? " needs" : ""}`}>
      <div className="aib-space-head">
        <button type="button" className="aib-space-toggle" onClick={() => setOpen((v) => !v)}>
          <span className="aib-space-name">{target.tasks?.length ?? 0} tasks</span>
          {target.note && <span className="aib-space-meta">{target.note}</span>}
        </button>
        <button type="button" className="aib-drop" onClick={onDrop} title="Remove from plan">
          {Icons.close}
        </button>
      </div>

      <div className="aib-dest-block">
        <div className="aib-dest-h">
          {target.needsChoice ? "Where should this go?" : "Destination"}
        </div>
        <DestPicker context={context} dest={dest} onDest={onDest} />
      </div>

      {open && (
        <div className="aib-tasks aib-target-tasks">
          {(target.tasks ?? []).map((t, ti) => (
            <div key={ti} className="aib-task">
              <span className="aib-task-dot" />
              <span className="aib-task-name">{t.name}</span>
              {t.priority && (
                <span className={`aib-pri aib-pri-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
              )}
              {typeof t.dueInDays === "number" && (
                <span className="aib-due">{t.dueInDays === 0 ? "today" : `${t.dueInDays}d`}</span>
              )}
              {t.recurrence && (
                <span className="aib-recur" title="Repeats when completed">
                  {Icons.repeat}
                  {t.recurrence.interval > 1
                    ? `every ${t.recurrence.interval} ${t.recurrence.freq === "daily" ? "days" : t.recurrence.freq === "weekly" ? "weeks" : "months"}`
                    : t.recurrence.freq}
                </span>
              )}
              {context.members.length > 0 && (
                <TaskAssignees
                  members={context.members}
                  memberName={memberName}
                  ids={t.assigneeIds ?? []}
                  onChange={(ids) => onAssignees(ti, ids)}
                />
              )}
            </div>
          ))}
          {(target.tasks?.length ?? 0) === 0 && <div className="aib-task muted">No tasks</div>}
          {(target.docs ?? []).map((d, di) => (
            <div key={`doc-${di}`} className="aib-task">
              <span className="aib-task-ic">{Icons.docs}</span>
              <span className="aib-task-name">
                {d.icon ? `${d.icon} ` : ""}
                {d.name}
              </span>
              <span className="aib-doc-tag">Doc</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- Per-task assignee picker ------------------------------------- */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function TaskAssignees({
  members,
  memberName,
  ids,
  onChange,
}: {
  members: { id: string; name: string }[];
  memberName: Map<string, string>;
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // The menu is rendered in a portal at fixed coords so it can never be
  // clipped by the modal's scrolling body (which is the reason the picker
  // "disappeared down" on lower tasks). It also flips above the button when
  // there isn't room below.
  const [coords, setCoords] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const available = members.filter((m) => !ids.includes(m.id));

  const toggle = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom;
      const up = below < 250 && r.top > below;
      setCoords({ top: up ? r.top - 4 : r.bottom + 4, left: r.right, up });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (): void => setOpen(false);
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (document.querySelector(".aib-assign-menu-portal")?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    // Any scroll shifts the anchor, so just close rather than re-track.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="aib-assign">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className="aib-av"
          title={`${memberName.get(id) ?? "Member"} — click to unassign`}
          onClick={() => onChange(ids.filter((x) => x !== id))}
        >
          {initials(memberName.get(id) ?? "?")}
        </button>
      ))}
      <span className="aib-assign-add-wrap">
        <button
          ref={btnRef}
          type="button"
          className="aib-assign-add"
          title="Assign teammate"
          onClick={toggle}
        >
          {Icons.plus}
        </button>
        {open &&
          coords &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="aib-assign-menu aib-assign-menu-portal"
              style={{
                top: coords.top,
                left: coords.left,
                transform: coords.up ? "translate(-100%, -100%)" : "translateX(-100%)",
              }}
            >
              {available.length === 0 && (
                <span className="aib-assign-empty muted">Everyone assigned</span>
              )}
              {available.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="aib-assign-item"
                  onClick={() => {
                    onChange([...ids, m.id]);
                    setOpen(false);
                  }}
                >
                  <span className="aib-av aib-av-sm">{initials(m.name)}</span>
                  {m.name}
                </button>
              ))}
            </div>,
            document.body,
          )}
      </span>
    </span>
  );
}
