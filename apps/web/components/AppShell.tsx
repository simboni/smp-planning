"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  authApi,
  chatApi,
  clearTokens,
  eventsApi,
  getUser,
  getWorkspace,
  notificationsApi,
  setUser,
  setWorkspace,
  tasksApi,
  timeApi,
  workspacesApi,
  type AppNotification,
  type OnlineUser,
  type PublicUser,
  type RunningTimer,
  type WorkspaceSummary,
} from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import {
  applyBranding,
  applyTheme,
  getTheme,
  resolvedTheme,
  setTheme,
  type Theme,
} from "@/lib/theme";
import {
  haptic,
  initBackButton,
  initDeepLinks,
  registerPush,
  syncStatusBar,
} from "@/lib/native";
import { CommandPalette } from "@/components/CommandPalette";
import { QuickTaskModal } from "@/components/QuickTaskModal";
import { HierarchyTree } from "@/components/HierarchyTree";
import { FavoritesNav } from "@/components/FavoritesNav";
import { Notepad } from "@/components/Notepad";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Icons, StackMark, type IconKey } from "@/components/icons";
import { colorFor, elapsedSeconds, formatTimer, initials, timeAgo } from "@/lib/format";

interface NavItem {
  href: string;
  label: string;
  icon: IconKey;
}

/** Route-aware active check, shared by the sidebar and the native app bar. */
function isNavActive(item: NavItem, pathname: string): boolean {
  return (
    pathname === item.href ||
    pathname.startsWith(`${item.href}/`) ||
    (item.href === "/docs" && pathname === "/doc") ||
    (item.href === "/whiteboards" &&
      (pathname === "/whiteboard" || pathname === "/mindmap")) ||
    (item.href === "/forms" && pathname === "/form-builder") ||
    (item.href === "/goals" && pathname === "/goal") ||
    (item.href === "/portfolios" && pathname === "/portfolio") ||
    (item.href === "/dashboards" && pathname === "/dashboard-view")
  );
}

// Tabs pinned to the native bottom bar; the rest lives in the Menu sheet.
const NATIVE_TAB_HREFS = ["/dashboard", "/my-work", "/inbox"];

const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/my-work", label: "My Work", icon: "checkCircle" },
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/templates", label: "Templates", icon: "copy" },
  { href: "/dashboards", label: "Dashboards", icon: "dashboards" },
  { href: "/chat", label: "Chat", icon: "chat" },
  { href: "/timesheet", label: "Timesheet", icon: "clock" },
  { href: "/workload", label: "Workload", icon: "workload" },
  { href: "/docs", label: "Docs", icon: "docs" },
  { href: "/whiteboards", label: "Whiteboards", icon: "whiteboard" },
  { href: "/forms", label: "Forms", icon: "clipboard" },
  { href: "/goals", label: "Goals", icon: "goals" },
  { href: "/portfolios", label: "Portfolios", icon: "briefcase" },
  { href: "/members", label: "Members", icon: "members" },
  { href: "/teams", label: "Teams", icon: "team" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUserState] = useState<PublicUser | null>(null);
  const [workspace, setWorkspaceState] = useState<WorkspaceSummary | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Module 6 — notifications (bell + Inbox badge) and presence.
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>("system");

  // Native app shell (Capacitor) — layout.tsx sets data-app="native" early.
  const [native, setNative] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Module 13 — total unread chat messages across all channels & DMs.
  const [chatUnread, setChatUnread] = useState(0);

  // Module 8 — the caller's running timer (global topbar chip).
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const [, setTimerTick] = useState(0); // 1s re-render while running
  const [stoppingTimer, setStoppingTimer] = useState(false);

  const loadTimer = (): void => {
    timeApi
      .runningTimer()
      .then((r) => setTimer(r.running))
      .catch(() => undefined);
  };

  useEffect(loadTimer, []);

  useRealtime((e) => {
    if (e.type === "time.changed") loadTimer();
  }, []);

  // Local 1s tick keeps the elapsed readout live.
  useEffect(() => {
    if (!timer) return;
    const t = setInterval(() => setTimerTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [timer]);

  const stopTimer = (): void => {
    if (stoppingTimer) return;
    setStoppingTimer(true);
    timeApi
      .stopTimer()
      .then(() => setTimer(null))
      .catch(() => loadTimer())
      .finally(() => setStoppingTimer(false));
  };

  const loadNotifications = (): void => {
    notificationsApi
      .list()
      .then((r) => {
        setNotifications(r.notifications);
        setUnreadCount(r.unreadCount);
      })
      .catch(() => undefined);
  };
  const loadOnline = (): void => {
    eventsApi
      .online()
      .then((r) => setOnline(r.online))
      .catch(() => undefined);
  };
  const loadChatUnread = (): void => {
    chatApi
      .list()
      .then((r) => setChatUnread(r.channels.reduce((sum, c) => sum + (c.unread || 0), 0)))
      .catch(() => undefined);
  };

  useEffect(() => {
    loadNotifications();
    loadOnline();
    loadChatUnread();
  }, []);

  useRealtime((e) => {
    if (e.type === "notification.new") loadNotifications();
    if (e.type === "presence") loadOnline();
    if (e.type === "chat.message") loadChatUnread();
  }, []);

  // Refresh the chat badge when returning to any non-chat page (a channel
  // marks itself read on open, which lowers the total).
  useEffect(() => {
    if (!pathname.startsWith("/chat")) loadChatUnread();
  }, [pathname]);

  const markAllRead = (): void => {
    setNotifications((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
    );
    setUnreadCount(0);
    notificationsApi.markAllRead().catch(() => loadNotifications());
  };

  /** Mark one read, then jump to the task's list when we can resolve it. */
  const openNotification = (n: AppNotification): void => {
    setBellOpen(false);
    if (!n.readAt) {
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      notificationsApi.markRead(n.id).catch(() => loadNotifications());
    }
    if (n.taskId) {
      tasksApi
        .get(n.taskId)
        .then((r) => router.push(`/list?id=${r.task.listId}&task=${r.task.id}`))
        .catch(() => undefined);
    }
  };

  // Hydrate identity + workspace from cache; fetch if missing.
  useEffect(() => {
    const cachedUser = getUser();
    const cachedWs = getWorkspace();
    if (cachedUser) setUserState(cachedUser);
    if (cachedWs) setWorkspaceState(cachedWs);

    if (!cachedUser) {
      authApi
        .me()
        .then((r) => {
          setUser(r.user);
          setUserState(r.user);
        })
        .catch(() => undefined);
    }
    if (!cachedWs) {
      workspacesApi
        .current()
        .then((r) => {
          setWorkspace(r.workspace);
          setWorkspaceState(r.workspace);
        })
        .catch(() => undefined);
    }
  }, []);

  // Theme: sync React state to the persisted choice (the no-flash script in
  // layout already set data-theme before paint).
  useEffect(() => {
    const t = getTheme();
    setThemeState(t);
    applyTheme(t);
  }, []);

  // Native shell lifecycle: hardware back button + SSO deep links, once.
  useEffect(() => {
    if (document.documentElement.dataset.app !== "native") return;
    setNative(true);
    void initBackButton(router);
    void initDeepLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the Android status bar matched to the effective theme.
  useEffect(() => {
    if (!native) return;
    void syncStatusBar(resolvedTheme());
  }, [native, theme]);

  // Register for push once the user is known (token posts need identity).
  useEffect(() => {
    if (!native || !user) return;
    void registerPush();
  }, [native, user]);

  // Branding: theme the app from the active workspace's accent color.
  useEffect(() => {
    applyBranding(workspace?.color ?? null);
  }, [workspace?.color]);

  const cycleTheme = (): void => {
    const order: Theme[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setThemeState(next);
    setTheme(next);
  };

  // ⌘K / Ctrl-K toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close transient UI on navigation.
  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
    setBellOpen(false);
    setSheetOpen(false);
  }, [pathname]);

  // Click-away closes the account menu / notification panel.
  useEffect(() => {
    if (!menuOpen && !bellOpen) return;
    const close = (): void => {
      setMenuOpen(false);
      setBellOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen, bellOpen]);

  const signOut = (): void => {
    clearTokens();
    router.replace("/login");
  };

  const wsColor = workspace?.color || (workspace ? colorFor(workspace.id) : "#7B68EE");
  // Presence shows OTHER online teammates — not yourself (a lone self-avatar
  // is just noise), so the row only appears when someone else is online.
  const onlineOthers = online.filter((u) => u.id !== user?.id);

  // Native app bar title: the active primary destination, else the workspace.
  const currentNav = PRIMARY_NAV.find((i) => isNavActive(i, pathname));
  const pageLabel = currentNav?.label ?? workspace?.name ?? "StackUp";

  // The notifications panel — shared by the desktop bell and the native
  // app-bar bell (only one of the two wraps is visible at a time).
  const bellPanel = (
    <div className="menu bell-panel" onClick={(e) => e.stopPropagation()}>
      <div className="bell-panel-head">
        <span className="bell-panel-title">Notifications</span>
        {unreadCount > 0 && (
          <button type="button" className="cm-action" onClick={markAllRead}>
            Mark all read
          </button>
        )}
      </div>
      <div className="bell-panel-list">
        {notifications.filter((n) => !n.readAt).length === 0 ? (
          <div className="bell-empty">
            {Icons.checkCircle}
            <span>You're all caught up.</span>
          </div>
        ) : (
          notifications
            .filter((n) => !n.readAt)
            .slice(0, 8)
            .map((n) => (
              <button
                key={n.id}
                type="button"
                className="notif-row unread"
                onClick={() => openNotification(n)}
              >
                <span
                  className="avatar avatar-sm"
                  style={{ background: colorFor(n.actor?.id ?? "sys") }}
                >
                  {n.actor ? initials(n.actor.fullName) : "•"}
                </span>
                <span className="notif-body">
                  <span className="notif-msg">{n.message}</span>
                  <span className="notif-meta">
                    {n.taskName && (
                      <span className="notif-task">{n.taskName}</span>
                    )}
                    <span className="notif-time">{timeAgo(n.createdAt)}</span>
                  </span>
                </span>
                <span className="notif-dot" aria-hidden="true" />
              </button>
            ))
        )}
      </div>
      <Link href="/inbox" className="bell-panel-foot" onClick={() => setBellOpen(false)}>
        View all in Inbox {Icons.arrowRight}
      </Link>
    </div>
  );

  return (
    <div className="shell">
      <aside className={`sidebar web-only${drawerOpen ? " open" : ""}`}>
        <div className="sidebar-brand">
          <Link href="/dashboard" className="brand">
            <span className="brand-mark">
              <StackMark />
            </span>
            <span className="brand-name">
              Stack<span className="up">Up</span>
            </span>
          </Link>
        </div>

        <nav>
          <div className="nav-section">
            {PRIMARY_NAV.map((item) => {
              const active = isNavActive(item, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`navlink${active ? " active" : ""}`}
                >
                  {Icons[item.icon]}
                  {item.label}
                  {item.href === "/inbox" && unreadCount > 0 && (
                    <span className="nav-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
                  )}
                  {item.href === "/chat" && chatUnread > 0 && (
                    <span className="nav-badge">{chatUnread > 99 ? "99+" : chatUnread}</span>
                  )}
                </Link>
              );
            })}
          </div>

          <Suspense fallback={null}>
            <FavoritesNav />
          </Suspense>

          <Suspense
            fallback={
              <div className="nav-section tree-section">
                <div className="nav-title">Spaces</div>
              </div>
            }
          >
            <HierarchyTree />
          </Suspense>
        </nav>

        <div className="sidebar-foot">
          <button className="ws-chip" onClick={() => router.push("/select")}>
            <span className="ws-chip-av" style={{ background: wsColor }}>
              {workspace ? initials(workspace.name) : "•"}
            </span>
            <span className="ws-chip-body">
              <span className="ws-chip-name">{workspace?.name ?? "Workspace"}</span>
              <span className="ws-chip-sub">Switch workspace</span>
            </span>
            <span className="ws-chip-caret">{Icons.switch}</span>
          </button>
        </div>
      </aside>

      <div
        className={`scrim web-only${drawerOpen ? " show" : ""}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      <div className="shell-main">
        <header className="topbar web-only">
          <button
            type="button"
            className="hamburger"
            aria-label="Menu"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            ☰
          </button>

          <button
            type="button"
            className="newtask-btn"
            onClick={() => setNewTaskOpen(true)}
            aria-label="New task"
          >
            {Icons.plus}
            <span className="newtask-label">New Task</span>
          </button>

          <button
            type="button"
            className="topbar-search"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
          >
            {Icons.search}
            <span className="label">Search or jump to…</span>
            <kbd>⌘K</kbd>
          </button>

          <span className="topbar-spacer" />

          <div className="topbar-tools">
            {timer && (
              <div className="timer-chip" title={`Timing “${timer.task.name}”`}>
                <span className="timer-chip-dot" aria-hidden="true" />
                <button
                  type="button"
                  className="timer-chip-name"
                  onClick={() =>
                    router.push(`/list?id=${timer.task.listId}&task=${timer.task.id}`)
                  }
                >
                  {timer.task.name}
                </button>
                <span className="timer-chip-time">
                  {formatTimer(elapsedSeconds(timer.entry.startedAt))}
                </span>
                <button
                  type="button"
                  className="timer-chip-stop"
                  aria-label="Stop timer"
                  title="Stop timer"
                  disabled={stoppingTimer}
                  onClick={stopTimer}
                >
                  {Icons.stop}
                </button>
              </div>
            )}

            {onlineOthers.length > 0 && (
              <div
                className="presence-row"
                aria-label={`${onlineOthers.length} teammate(s) online`}
              >
                {onlineOthers.slice(0, 5).map((u) => (
                  <span
                    key={u.id}
                    className="presence-av"
                    title={`${u.fullName} — online`}
                    style={{ background: colorFor(u.id) }}
                  >
                    {initials(u.fullName)}
                    <span className="presence-dot" />
                  </span>
                ))}
                {onlineOthers.length > 5 && (
                  <span
                    className="presence-av presence-more"
                    title={onlineOthers.slice(5).map((u) => u.fullName).join(", ")}
                  >
                    +{onlineOthers.length - 5}
                  </span>
                )}
              </div>
            )}

            <Link href="/members" className="btn btn-primary btn-sm">
              {Icons.invite}
              <span>Invite</span>
            </Link>

            <button
              type="button"
              className="icon-btn"
              onClick={cycleTheme}
              aria-label={`Theme: ${theme}. Click to change.`}
              title={
                theme === "system"
                  ? "Theme: System"
                  : theme === "light"
                    ? "Theme: Light"
                    : "Theme: Dark"
              }
            >
              {theme === "system"
                ? Icons.monitor
                : theme === "light"
                  ? Icons.sun
                  : Icons.moon}
            </button>

            <div className="bell-wrap">
              <button
                type="button"
                className="icon-btn bell-btn"
                aria-label={
                  unreadCount > 0
                    ? `Notifications — ${unreadCount} unread`
                    : "Notifications"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  setBellOpen((v) => !v);
                }}
              >
                {Icons.bell}
                {unreadCount > 0 && (
                  <span className="bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
                )}
              </button>
              {bellOpen && bellPanel}
            </div>

            <div className="acct">
              <button
                type="button"
                className="acct-btn"
                aria-label="Account"
                onClick={(e) => {
                  e.stopPropagation();
                  setBellOpen(false);
                  setMenuOpen((v) => !v);
                }}
              >
                <span className="avatar" style={{ background: colorFor(user?.id ?? "u") }}>
                  {user ? initials(user.fullName || user.email) : "•"}
                </span>
              </button>
              {menuOpen && (
                <div className="menu" onClick={(e) => e.stopPropagation()}>
                  <div className="menu-head">
                    <span className="avatar" style={{ background: colorFor(user?.id ?? "u") }}>
                      {user ? initials(user.fullName || user.email) : "•"}
                    </span>
                    <span className="menu-head-body">
                      <span className="menu-name">{user?.fullName ?? "Your account"}</span>
                      <span className="menu-email">{user?.email ?? ""}</span>
                    </span>
                  </div>
                  <Link href="/settings">{Icons.settings} Settings</Link>
                  <button type="button" onClick={() => router.push("/select")}>
                    {Icons.switch} Switch workspace
                  </button>
                  <button type="button" className="danger" onClick={signOut}>
                    {Icons.signout} Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ---- Native app chrome: pull-to-refresh + compact top app bar (Capacitor only) ---- */}
        <PullToRefresh />
        <header className="app-appbar app-only">
          <span className="app-appbar-title">{pageLabel}</span>
          <span className="app-appbar-tools">
            <button
              type="button"
              className="icon-btn"
              aria-label="Search"
              onClick={() => setPaletteOpen(true)}
            >
              {Icons.search}
            </button>
            <div className="bell-wrap">
              <button
                type="button"
                className="icon-btn bell-btn"
                aria-label={
                  unreadCount > 0
                    ? `Notifications — ${unreadCount} unread`
                    : "Notifications"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  setBellOpen((v) => !v);
                }}
              >
                {Icons.bell}
                {unreadCount > 0 && (
                  <span className="bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
                )}
              </button>
              {bellOpen && bellPanel}
            </div>
          </span>
        </header>

        <main>{children}</main>

        {/* ---- Native app chrome: bottom tab bar (Capacitor only) ---- */}
        <nav className="app-tabbar app-only" aria-label="Primary">
          <Link
            href="/dashboard"
            className={`app-tab${isNavActive(PRIMARY_NAV[0], pathname) ? " active" : ""}`}
          >
            {Icons.home}
            <span>Home</span>
          </Link>
          <Link
            href="/my-work"
            className={`app-tab${isNavActive(PRIMARY_NAV[1], pathname) ? " active" : ""}`}
          >
            {Icons.checkCircle}
            <span>Tasks</span>
          </Link>
          <button
            type="button"
            className="app-tab-new"
            aria-label="New task"
            onClick={() => {
              void haptic("light");
              setNewTaskOpen(true);
            }}
          >
            {Icons.plus}
          </button>
          <Link
            href="/inbox"
            className={`app-tab${isNavActive(PRIMARY_NAV[2], pathname) ? " active" : ""}`}
          >
            {Icons.inbox}
            <span>Inbox</span>
            {unreadCount > 0 && (
              <span className="app-tab-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
            )}
          </Link>
          <button
            type="button"
            className={`app-tab${sheetOpen ? " active" : ""}`}
            onClick={() => setSheetOpen((v) => !v)}
          >
            {Icons.more}
            <span>Menu</span>
          </button>
        </nav>

        {/* ---- Native app chrome: full-screen Menu sheet ---- */}
        {sheetOpen && (
          <div className="app-sheet app-only" role="dialog" aria-label="Menu">
            <div className="app-sheet-head">
              <span className="app-sheet-title">Menu</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close menu"
                onClick={() => setSheetOpen(false)}
              >
                {Icons.close}
              </button>
            </div>
            <div className="app-sheet-list">
              {PRIMARY_NAV.filter((i) => !NATIVE_TAB_HREFS.includes(i.href)).map(
                (item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`app-sheet-link${isNavActive(item, pathname) ? " active" : ""}`}
                    onClick={() => setSheetOpen(false)}
                  >
                    {Icons[item.icon]}
                    {item.label}
                    {item.href === "/chat" && chatUnread > 0 && (
                      <span className="nav-badge">
                        {chatUnread > 99 ? "99+" : chatUnread}
                      </span>
                    )}
                  </Link>
                ),
              )}
              <button
                type="button"
                className="app-sheet-link"
                onClick={() => {
                  setSheetOpen(false);
                  router.push("/select");
                }}
              >
                {Icons.switch}
                Switch workspace
              </button>
              <button type="button" className="app-sheet-link" onClick={cycleTheme}>
                {theme === "system"
                  ? Icons.monitor
                  : theme === "light"
                    ? Icons.sun
                    : Icons.moon}
                Theme: {theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"}
              </button>
            </div>
          </div>
        )}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {newTaskOpen && <QuickTaskModal onClose={() => setNewTaskOpen(false)} />}
      <Notepad />
    </div>
  );
}
