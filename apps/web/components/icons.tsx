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
  team: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="8" cy="8.5" r="2.8" />
      <path d="M2.8 19c.7-2.8 2.7-4.2 5.2-4.2s4.5 1.4 5.2 4.2" />
      <circle cx="16.5" cy="7.5" r="2.4" />
      <path d="M16 14.6c2.2 0 4 1.3 4.6 3.9" />
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="6" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path d="M8.4 10.9 15.6 7.1M8.4 13.1l7.2 3.8" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  circle: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="8" />
    </svg>
  ),
  checkCircle: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 12.2 11 14.7 15.7 9.7" />
    </svg>
  ),
  flag: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M5 21V4M5 4.5h11l-2 3.5 2 3.5H5" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 9.5h16M8 3.5v3M16 3.5v3" />
    </svg>
  ),
  tag: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 4h7l9 9-7 7-9-9z" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  ),
  subtask: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M6 4v10a3 3 0 0 0 3 3h9" />
      <path d="M15 13.5 18.5 17 15 20.5" />
    </svg>
  ),
  paperclip: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M20 11.5 12 19.5a4.5 4.5 0 0 1-6.4-6.4L14 4.7a3 3 0 0 1 4.3 4.3l-8.4 8.4a1.5 1.5 0 0 1-2.2-2.1l7.6-7.6" />
    </svg>
  ),
  userPlus: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5 1.2 0 2.3.3 3.2.9" />
      <path d="M17.5 13v6M14.5 16h6" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  ),
  checkSquare: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.5 12.2 11 14.7 15.7 9.7" />
    </svg>
  ),
  diamond: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />
    </svg>
  ),
  diamondFill: (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />
    </svg>
  ),
  link: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M10.3 13.7a4.2 4.2 0 0 0 6 0l3.2-3.2a4.24 4.24 0 1 0-6-6l-1.6 1.6" />
      <path d="M13.7 10.3a4.2 4.2 0 0 0-6 0l-3.2 3.2a4.24 4.24 0 1 0 6 6l1.6-1.6" />
    </svg>
  ),
  ban: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6l12 12" />
    </svg>
  ),
  repeat: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4.5 12a7.5 7.5 0 0 1 7.5-7.5 7.5 7.5 0 0 1 6.4 3.6" />
      <path d="M18.9 3.6v4.5h-4.5" />
      <path d="M19.5 12A7.5 7.5 0 0 1 12 19.5a7.5 7.5 0 0 1-6.4-3.6" />
      <path d="M5.1 20.4v-4.5h4.5" />
    </svg>
  ),
  sliders: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 7h9M17.5 7H20M4 12h3M11.5 12H20M4 17h9M17.5 17H20" />
      <circle cx="15" cy="7" r="2.2" />
      <circle cx="9" cy="12" r="2.2" />
      <circle cx="15" cy="17" r="2.2" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="m12 3.6 2.5 5.2 5.7.8-4.2 4 1 5.7-5-2.7-5 2.7 1-5.7-4.2-4 5.7-.8z" />
    </svg>
  ),
  starFill: (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="m12 3.6 2.5 5.2 5.7.8-4.2 4 1 5.7-5-2.7-5 2.7 1-5.7-4.2-4 5.7-.8z" />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M5 4h4l1.5 4.5-2.2 1.7a13 13 0 0 0 5.5 5.5l1.7-2.2L20 15v4a1.5 1.5 0 0 1-1.6 1.5C10.6 20 4 13.4 3.5 5.6A1.5 1.5 0 0 1 5 4z" />
    </svg>
  ),
  hash: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M9.2 4 7.6 20M16.4 4l-1.6 16M4.5 9h16M3.5 15h16" />
    </svg>
  ),
  coin: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.8 9.3c-.5-.9-1.6-1.5-2.8-1.5-1.7 0-3 .9-3 2.2s1.3 1.8 3 2c1.7.2 3 .7 3 2s-1.3 2.2-3 2.2c-1.2 0-2.3-.6-2.8-1.5M12 6v1.8M12 16.2V18" />
    </svg>
  ),
  /* ---- Module 5: Views Engine ---- */
  board: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="3.5" y="4" width="5.4" height="16" rx="1.5" />
      <rect x="11.3" y="4" width="5.4" height="11" rx="1.5" />
      <rect x="19.1" y="4" width="1.4" height="7" rx="0.7" />
    </svg>
  ),
  table: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M3.5 14.5h17M10 9.5v10M16 9.5v10" />
    </svg>
  ),
  gantt: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 5v14" />
      <path d="M7 7.5h7M9.5 12h9M7 16.5h5" strokeWidth={2.6} />
    </svg>
  ),
  filter: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 5h16l-6.2 7.2V19l-3.6-2v-4.8z" />
    </svg>
  ),
  sortAsc: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 6h9M4 12h6M4 18h4" />
      <path d="M17 18V7M13.8 10.2 17 7l3.2 3.2" />
    </svg>
  ),
  sortDesc: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 6h4M4 12h6M4 18h9" />
      <path d="M17 6v11M13.8 13.8 17 17l3.2-3.2" />
    </svg>
  ),
  group: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="4" y="4" width="16" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="16" height="6.5" rx="1.5" />
    </svg>
  ),
  chevronLeft: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  ),
  /* ---- Module 6: Real-time collaboration ---- */
  bell: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M12 4a6 6 0 0 0-6 6v4.2L4.4 17h15.2L18 14.2V10a6 6 0 0 0-6-6z" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M20.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18v-4.5" />
      <path d="M3.5 13.5 6.2 5.5h11.6l2.7 8" />
      <path d="M3.5 13.5H9l1.4 2.5h3.2l1.4-2.5h5.5" />
    </svg>
  ),
  atSign: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="3.4" />
      <path d="M15.4 12v1.4a2.2 2.2 0 0 0 4.4 0V12a7.8 7.8 0 1 0-3.1 6.2" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M20.5 3.5 10.8 13.2" />
      <path d="M20.5 3.5 14 20.5l-3.2-7.3L3.5 10z" />
    </svg>
  ),
  smile: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14.5a4.4 4.4 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" strokeWidth={2.4} />
    </svg>
  ),
  /* ---- Module 7: Docs & Notepad ---- */
  note: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4.5 4.5h15v10.5L15 19.5H4.5z" />
      <path d="M15 19.5V15h4.5" />
      <path d="M8 9h8M8 12.5h5" />
    </svg>
  ),
  pageAdd: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  ),
  /* ---- Module 8: Time tracking, timesheets & workload ---- */
  play: (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M8 5.5v13a1 1 0 0 0 1.52.86l10.2-6.5a1 1 0 0 0 0-1.72L9.52 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  ),
  stop: (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  ),
  timer: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.6 1.7" />
      <path d="M9.5 3h5" />
      <path d="M12 3v3" />
    </svg>
  ),
  workload: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 4v16" />
      <path d="M4 7.5h12M4 12h16M4 16.5h8" strokeWidth={2.6} />
    </svg>
  ),
  /* ---- Module 9: Goals, OKRs & Portfolios ---- */
  briefcase: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2" />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
      <path d="M3 12.5c2.9 1.3 5.9 2 9 2s6.1-.7 9-2" />
      <path d="M12 13.5v2" />
    </svg>
  ),
  trendUp: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M3.5 17.5 9.5 11.5l4 4 7-7.5" />
      <path d="M15.5 8h5v5" />
    </svg>
  ),
  /* ---- Module 11: Forms & Automations ---- */
  clipboard: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 4.5V3.8A1.3 1.3 0 0 1 10.3 2.5h3.4A1.3 1.3 0 0 1 15 3.8v.7" />
      <path d="M8.5 10h7M8.5 13.5h7M8.5 17h4.5" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M5.5 15H4.8A1.8 1.8 0 0 1 3 13.2V4.8A1.8 1.8 0 0 1 4.8 3h8.4A1.8 1.8 0 0 1 15 4.8v.7" />
    </svg>
  ),
  zap: (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M13.2 2.3 4.3 13.4a.6.6 0 0 0 .47.98H10l-1.1 7.1c-.1.63.7.97 1.1.47l8.9-11.1a.6.6 0 0 0-.47-.98H14l1.1-7.1c.1-.63-.7-.97-1.1-.47z" />
    </svg>
  ),
  grip: (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  ),
  /* ---- Module 12: Whiteboards & Mind maps ---- */
  whiteboard: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="3" y="4" width="18" height="13.5" rx="2" />
      <path d="M8.5 21h7M12 17.5V21" />
      <path d="m7.2 13.2 3.6-4.6 2.4 2.6 3.4-4" />
    </svg>
  ),
  pen: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="m14.5 5.5 4 4L8 20H4v-4z" />
      <path d="m12.5 7.5 4 4" />
      <path d="M17 3l4 4-1.5 1.5-4-4z" />
    </svg>
  ),
  mindmap: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="5.5" cy="12" r="2.5" />
      <circle cx="18.5" cy="5.5" r="2.2" />
      <circle cx="18.5" cy="12" r="2.2" />
      <circle cx="18.5" cy="18.5" r="2.2" />
      <path d="M8 11.2c3 0 4.6-1.6 6-4M8 12h8.3M8 12.8c3 0 4.6 1.6 6 4" />
    </svg>
  ),
  branch: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="12" r="2.4" />
      <path d="M8.4 6c4 0 3.2 6 7.2 6M8.4 18c4 0 3.2-6 7.2-6" />
    </svg>
  ),
} as const;

export type IconKey = keyof typeof Icons;
