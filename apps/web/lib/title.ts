"use client";

import { useEffect } from "react";

/**
 * Browser tab titles ("Coding · StackUp"), so tabs and history are told
 * apart. Pages that show one thing (a Space, list, doc…) call usePageTitle
 * with its name; AppShell titles the rest from the sidebar item and stays out
 * of the way while a page has claimed the title.
 */
let claimed = 0;

export function setDocTitle(title?: string | null): void {
  if (typeof document === "undefined") return;
  document.title = title ? `${title} · StackUp` : "StackUp";
}

export function pageTitleClaimed(): boolean {
  return claimed > 0;
}

export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    claimed += 1;
    return () => {
      claimed -= 1;
    };
  }, []);
  useEffect(() => {
    if (title) setDocTitle(title);
  }, [title]);
}
