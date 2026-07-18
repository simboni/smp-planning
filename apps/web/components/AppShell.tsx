"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  authApi,
  clearTokens,
  getUser,
  getWorkspace,
  setUser,
  setWorkspace,
  workspacesApi,
  type PublicUser,
  type WorkspaceSummary,
} from "@/lib/api";
import { CommandPalette } from "@/components/CommandPalette";
import { Icons, StackMark, type IconKey } from "@/components/icons";
import { colorFor, initials } from "@/lib/format";

interface NavItem {
  href: string;
  label: string;
  icon: IconKey;
}

const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/members", label: "Members", icon: "members" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

const COMING_SOON: NavItem[] = [
  { href: "#", label: "Spaces", icon: "spaces" },
  { href: "#", label: "Tasks", icon: "tasks" },
  { href: "#", label: "Docs", icon: "docs" },
  { href: "#", label: "Goals", icon: "goals" },
  { href: "#", label: "Dashboards", icon: "dashboards" },
  { href: "#", label: "Chat", icon: "chat" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUserState] = useState<PublicUser | null>(null);
  const [workspace, setWorkspaceState] = useState<WorkspaceSummary | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
  }, [pathname]);

  // Click-away closes the account menu.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const signOut = (): void => {
    clearTokens();
    router.replace("/login");
  };

  const wsColor = workspace?.color || (workspace ? colorFor(workspace.id) : "#7B68EE");

  return (
    <div className="shell">
      <aside className={`sidebar${drawerOpen ? " open" : ""}`}>
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
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`navlink${active ? " active" : ""}`}
                >
                  {Icons[item.icon]}
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="nav-section">
            <div className="nav-title">Coming soon</div>
            {COMING_SOON.map((item) => (
              <span
                key={item.label}
                className="navlink soon"
                aria-disabled="true"
                title={`${item.label} — coming soon`}
              >
                {Icons[item.icon]}
                {item.label}
                <span className="soon-tag">Soon</span>
              </span>
            ))}
          </div>
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
        className={`scrim${drawerOpen ? " show" : ""}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      <div className="shell-main">
        <header className="topbar">
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
            <Link href="/members" className="btn btn-primary btn-sm">
              {Icons.invite}
              <span>Invite</span>
            </Link>

            <div className="acct">
              <button
                type="button"
                className="acct-btn"
                aria-label="Account"
                onClick={(e) => {
                  e.stopPropagation();
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

        <main>{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
