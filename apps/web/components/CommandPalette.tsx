"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icons, type IconKey } from "@/components/icons";

interface Destination {
  label: string;
  href: string;
  icon: IconKey;
  soon?: boolean;
  keywords?: string;
}

const DESTINATIONS: Destination[] = [
  { label: "Home", href: "/dashboard", icon: "home", keywords: "dashboard start" },
  { label: "Members", href: "/members", icon: "members", keywords: "people team invite" },
  { label: "Settings", href: "/settings", icon: "settings", keywords: "workspace preferences" },
  { label: "Everything", href: "/everything", icon: "spaces", keywords: "spaces folders lists overview" },
  { label: "Docs", href: "/docs", icon: "docs", keywords: "wiki pages notes write document" },
  { label: "Timesheet", href: "/timesheet", icon: "clock", keywords: "time tracking hours week entries submit approval" },
  { label: "Workload", href: "/workload", icon: "workload", keywords: "capacity team hours estimates planning" },
  { label: "Goals", href: "/goals", icon: "goals", keywords: "okr okrs objectives key results targets progress tracking" },
  { label: "Portfolios", href: "/portfolios", icon: "briefcase", keywords: "rollup roll-up lists projects overview progress" },
  { label: "Tasks", href: "#", icon: "tasks", soon: true },
  { label: "Dashboards", href: "#", icon: "dashboards", soon: true },
  { label: "Chat", href: "#", icon: "chat", soon: true },
];

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return DESTINATIONS;
    return DESTINATIONS.filter((d) =>
      `${d.label} ${d.keywords ?? ""}`.toLowerCase().includes(needle),
    );
  }, [q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  if (!open) return null;

  const go = (d: Destination): void => {
    if (d.soon) return;
    onClose();
    router.push(d.href);
  };

  return (
    <div className="palette-scrim" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrap">
          {Icons.search}
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search or jump to…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && results[active]) {
                e.preventDefault();
                go(results[active]);
              }
            }}
          />
        </div>

        <div className="palette-results">
          {results.length === 0 ? (
            <div className="palette-empty">No matches for “{q}”.</div>
          ) : (
            <>
              <div className="palette-group-title">Jump to</div>
              {results.map((d, i) => (
                <div
                  key={d.label}
                  className={`palette-hit${i === active ? " active" : ""}${d.soon ? " soon" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(d)}
                >
                  <span className="p-ic">{Icons[d.icon]}</span>
                  <span className="p-title">{d.label}</span>
                  {d.soon && <span className="p-tag">Soon</span>}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to navigate
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
