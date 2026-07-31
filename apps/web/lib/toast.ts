"use client";

/**
 * Module 14 — a dependency-free global toast + a "save as template" helper.
 *
 * The toast mounts a single transient element on `document.body` so any page
 * (or ⋯ menu item) can flash a confirmation without threading state through
 * its component tree. Every DOM touch is guarded so the static export never
 * runs it on the server.
 */

import { ApiError, templatesApi, type TemplateKind } from "@/lib/api";

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Flash a transient message near the bottom of the screen. */
export function showToast(message: string): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById("stackup-global-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "stackup-global-toast";
    el.className = "toast-global";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el?.classList.remove("show");
  }, 2600);
}

/**
 * A toast that carries ONE action — used for reversible actions (completing
 * a task, archiving) so a mis-click is never destructive: the confirmation
 * and the way back are the same element. Stays longer than a plain toast
 * because the user has to read it and decide.
 */
export function showToastAction(
  message: string,
  actionLabel: string,
  onAction: () => void,
): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById("stackup-global-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "stackup-global-toast";
    el.className = "toast-global";
    document.body.appendChild(el);
  }
  el.textContent = "";
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "toast-action";
  btn.textContent = actionLabel;
  btn.onclick = () => {
    el?.classList.remove("show");
    if (toastTimer) clearTimeout(toastTimer);
    onAction();
  };
  el.appendChild(text);
  el.appendChild(btn);
  el.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el?.classList.remove("show");
  }, 6000);
}

/**
 * Prompt for a name, then snapshot an entity as a template. Resolves true on
 * success. Toasts either way so the caller only needs one onClick.
 */
export async function saveEntityAsTemplate(
  kind: TemplateKind,
  id: string,
  defaultName: string,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const name = window.prompt(`Save this ${kind} as a template. Template name:`, defaultName);
  if (name === null) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  try {
    await templatesApi.createFrom(kind, id, { name: trimmed });
    showToast(`Saved “${trimmed}” to the Template Center.`);
    return true;
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : "Couldn't save the template.");
    return false;
  }
}
