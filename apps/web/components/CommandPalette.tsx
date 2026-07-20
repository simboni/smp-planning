"use client";

/**
 * Module 14 — the Command Center (⌘K).
 *
 * Empty query → Quick actions (create flows) + recent navigation destinations.
 * As the user types (debounced 180ms) it calls the universal search API and
 * renders grouped, icon-tagged hits (Tasks, Lists, Spaces, Docs, Goals,
 * Whiteboards, Channels). Fully keyboard-first: ↑/↓ move across a flattened
 * selection list, Enter navigates/acts, Esc closes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icons, type IconKey } from "@/components/icons";
import { useHierarchy } from "@/components/HierarchyProvider";
import {
  aiApi,
  docsApi,
  hierarchyApi,
  searchApi,
  whiteboardsApi,
  type SearchResults,
} from "@/lib/api";

/** One selectable row. `run` performs the action (navigate / create). */
interface Item {
  key: string;
  icon: IconKey;
  title: string;
  subtitle?: string | null;
  tag?: string;
  run: () => void;
}

interface Group {
  title: string;
  items: Item[];
}

const DESTINATIONS: { label: string; href: string; icon: IconKey; keywords?: string }[] = [
  { label: "My Work", href: "/my-work", icon: "checkCircle", keywords: "home tasks assigned mine today overdue" },
  { label: "Home", href: "/dashboard", icon: "home", keywords: "dashboard start" },
  { label: "Templates", href: "/templates", icon: "copy", keywords: "template center reuse blueprint" },
  { label: "Members", href: "/members", icon: "members", keywords: "people team invite" },
  { label: "Settings", href: "/settings", icon: "settings", keywords: "workspace preferences" },
  { label: "Everything", href: "/everything", icon: "spaces", keywords: "spaces folders lists overview" },
  { label: "Docs", href: "/docs", icon: "docs", keywords: "wiki pages notes write document" },
  { label: "Whiteboards", href: "/whiteboards", icon: "whiteboard", keywords: "canvas draw sticky notes shapes brainstorm visual board" },
  { label: "Forms", href: "/forms", icon: "clipboard", keywords: "form intake request survey submissions" },
  { label: "Timesheet", href: "/timesheet", icon: "clock", keywords: "time tracking hours week entries" },
  { label: "Workload", href: "/workload", icon: "workload", keywords: "capacity team hours planning" },
  { label: "Goals", href: "/goals", icon: "goals", keywords: "okr objectives key results targets" },
  { label: "Portfolios", href: "/portfolios", icon: "briefcase", keywords: "rollup lists projects progress" },
  { label: "Dashboards", href: "/dashboards", icon: "dashboards", keywords: "reporting charts widgets analytics" },
  { label: "Chat", href: "/chat", icon: "chat", keywords: "messages channels dm slack conversation" },
  { label: "Integrations & API", href: "/settings/integrations", icon: "bolt", keywords: "api tokens webhooks import export integrations pat developer" },
];

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { reload } = useHierarchy();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const nav = (href: string): void => {
    onClose();
    router.push(href);
  };

  // Reset on open.
  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setResults(null);
      setLoading(false);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Debounced live search (180ms). Empty query clears results.
  useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      let live = true;
      searchApi
        .search(needle)
        .then((r) => {
          if (live) setResults(r);
        })
        .catch(() => {
          if (live) setResults(null);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
      return () => {
        live = false;
      };
    }, 180);
    return () => clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    setActive(0);
  }, [q, results]);

  /* -- quick create actions (empty state) --------------------------- */
  const quickActions: Item[] = useMemo(
    () => [
      {
        key: "new-task",
        icon: "tasks",
        title: "New task…",
        subtitle: "Pick a list to add a task",
        run: () => nav("/everything"),
      },
      {
        key: "new-doc",
        icon: "docs",
        title: "New doc",
        subtitle: "Start a blank document",
        run: () => {
          onClose();
          docsApi
            .create({ name: "Untitled doc" })
            .then((r) => router.push(`/doc?id=${r.doc.id}`))
            .catch(() => router.push("/docs"));
        },
      },
      {
        key: "new-space",
        icon: "spaces",
        title: "New space",
        subtitle: "Organize teams, folders & lists",
        run: () => {
          onClose();
          hierarchyApi
            .createSpace({ name: "New space" })
            .then((r) => {
              void reload();
              router.push(`/space?id=${r.space.id}`);
            })
            .catch(() => router.push("/everything"));
        },
      },
      {
        key: "new-whiteboard",
        icon: "whiteboard",
        title: "New whiteboard",
        subtitle: "Open a fresh canvas",
        run: () => {
          onClose();
          whiteboardsApi
            .create({ name: "Untitled board" })
            .then((r) => router.push(`/whiteboard?id=${r.whiteboard.id}`))
            .catch(() => router.push("/whiteboards"));
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* -- build the visible groups ------------------------------------- */
  const groups: Group[] = useMemo(() => {
    const needle = q.trim().toLowerCase();

    if (!needle) {
      const dests: Item[] = DESTINATIONS.map((d) => ({
        key: `dest:${d.href}:${d.label}`,
        icon: d.icon,
        title: d.label,
        run: () => nav(d.href),
      }));
      return [
        { title: "Quick actions", items: quickActions },
        { title: "Jump to", items: dests },
      ];
    }

    const out: Group[] = [];

    // AI: interpret the raw query as a natural-language command. Shown first
    // so ⌘K doubles as an "ask AI" bar; routing is intentionally conservative.
    if (needle) {
      const text = q.trim();
      out.push({
        title: "AI",
        items: [
          {
            key: "ai-command",
            icon: "zap",
            title: `Ask AI · “${text}”`,
            subtitle: "Interpret as a command",
            tag: "AI",
            run: () => {
              onClose();
              void aiApi
                .command(text)
                .then(({ command }) => {
                  if (command.intent === "create_task") {
                    router.push("/everything");
                  } else if (command.intent === "search") {
                    router.push(`/everything`);
                  }
                })
                .catch(() => undefined);
            },
          },
        ],
      });
    }

    if (!results) return out;

    if (results.tasks.length)
      out.push({
        title: "Tasks",
        items: results.tasks.map((t) => ({
          key: `task:${t.id}`,
          icon: "tasks",
          title: t.title,
          subtitle: t.subtitle,
          run: () => nav(`/list?id=${t.listId}&task=${t.id}`),
        })),
      });
    if (results.lists.length)
      out.push({
        title: "Lists",
        items: results.lists.map((l) => ({
          key: `list:${l.id}`,
          icon: "list",
          title: l.name,
          subtitle: l.spaceName,
          run: () => nav(`/list?id=${l.id}`),
        })),
      });
    if (results.spaces.length)
      out.push({
        title: "Spaces",
        items: results.spaces.map((sp) => ({
          key: `space:${sp.id}`,
          icon: "spaces",
          title: sp.icon ? `${sp.icon}  ${sp.name}` : sp.name,
          run: () => nav(`/space?id=${sp.id}`),
        })),
      });
    if (results.docs.length)
      out.push({
        title: "Docs",
        items: results.docs.map((d) => ({
          key: `doc:${d.id}`,
          icon: "docs",
          title: d.icon ? `${d.icon}  ${d.name}` : d.name,
          run: () => nav(`/doc?id=${d.id}`),
        })),
      });
    if (results.goals.length)
      out.push({
        title: "Goals",
        items: results.goals.map((g) => ({
          key: `goal:${g.id}`,
          icon: "goals",
          title: g.name,
          run: () => nav(`/goal?id=${g.id}`),
        })),
      });
    if (results.whiteboards.length)
      out.push({
        title: "Whiteboards",
        items: results.whiteboards.map((w) => ({
          key: `wb:${w.id}`,
          icon: "whiteboard",
          title: w.name,
          run: () => nav(`/whiteboard?id=${w.id}`),
        })),
      });
    if (results.channels.length)
      out.push({
        title: "Channels",
        items: results.channels.map((c) => ({
          key: `chan:${c.id}`,
          icon: "chat",
          title: c.name,
          run: () => nav(`/chat?c=${c.id}`),
        })),
      });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, results, quickActions]);

  // Flattened selectable list for ↑/↓/Enter.
  const flat: Item[] = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  if (!open) return null;

  const searching = q.trim().length > 0;

  return (
    <div className="palette-scrim" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrap">
          {Icons.search}
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search tasks, docs, spaces… or jump to"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, flat.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && flat[active]) {
                e.preventDefault();
                flat[active].run();
              }
            }}
          />
          {loading && <span className="palette-spinner" aria-hidden="true" />}
        </div>

        <div className="palette-results">
          {searching && loading && flat.length === 0 ? (
            <div className="palette-empty">Searching…</div>
          ) : searching && flat.length === 0 && !loading ? (
            <div className="palette-empty">No matches for “{q}”.</div>
          ) : (
            groups.map((group) => (
              <div key={group.title} className="palette-group">
                <div className="palette-group-title">{group.title}</div>
                {group.items.map((item) => {
                  const idx = flat.indexOf(item);
                  return (
                    <div
                      key={item.key}
                      className={`palette-hit${idx === active ? " active" : ""}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => item.run()}
                    >
                      <span className="p-ic">{Icons[item.icon]}</span>
                      <span className="p-body">
                        <span className="p-title">{item.title}</span>
                        {item.subtitle && <span className="p-sub">{item.subtitle}</span>}
                      </span>
                      {item.tag && <span className="p-tag">{item.tag}</span>}
                    </div>
                  );
                })}
              </div>
            ))
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
