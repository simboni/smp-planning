/**
 * Inline 24×24 stroke icon set — no dependencies, no external requests
 * (required for the static export + CSP). Currentcolor everywhere so a
 * single CSS rule tints them.
 */
import type { ReactElement } from "react";

const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** The StackUp mark: three stacked rounded squares. Fills with currentColor. */
export function StackMark({ className }: { className?: string }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 3 21 7.5 12 12 3 7.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path
        d="M3 12 12 16.5 21 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 16.5 12 21 21 16.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const Icons = {
  home: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  ),
  members: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
      <path d="M15.5 5.8a3.2 3.2 0 0 1 0 5.4M17.7 14.9c1.6.7 2.8 2 3.3 4.1" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
    </svg>
  ),
  spaces: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </svg>
  ),
  tasks: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 6h4M4 12h4M4 18h4" />
      <path d="M11.5 6h8.5M11.5 12h8.5M11.5 18h8.5" />
    </svg>
  ),
  docs: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  ),
  goals: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  ),
  dashboards: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8.5 16v-5M13 16V8M17.5 16v-3" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 5 5" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M5 12.5 10 17.5 19.5 6.5" />
    </svg>
  ),
  arrowRight: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  chevronRight: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  ),
  chevronDown: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  switch: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 8h12l-3-3M20 16H8l3 3" />
    </svg>
  ),
  signout: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M14 4H6v16h8" />
      <path d="M17 8.5 20.5 12 17 15.5M10 12h10.5" />
    </svg>
  ),
  invite: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5 1.2 0 2.3.3 3.2.9" />
      <path d="M17.5 13v6M14.5 16h6" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  ),
  bolt: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  ),
  folderOpen: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v1.5H6l-3 8" />
      <path d="M3 18.5 6 10.5h15l-2.6 7A1.5 1.5 0 0 1 17 18.5z" />
    </svg>
  ),
  list: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.83-2.83L5 17.2z" />
      <path d="M14 8.5 16 10.5" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
  archive: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5" />
      <path d="M10 12h4" />
    </svg>
  ),
  palette: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" />
      <circle cx="7.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  everything: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M3 6.5 12 3l9 3.5-9 3.5z" />
      <path d="M3 12l9 3.5L21 12" />
      <path d="M3 17.5 12 21l9-3.5" />
    </svg>
  ),
  arrowUp: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  ),
  arrowDown: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  ),
} as const;

export type IconKey = keyof typeof Icons;
