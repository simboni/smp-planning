"use client";

/**
 * StackUp API client.
 *
 * Two-stage token model:
 *   - identityToken — issued at signup/login; authorizes the account-level
 *     surface: listing, creating and selecting workspaces.
 *   - accessToken   — minted by selecting a workspace; authorizes every
 *     workspace-scoped call (members, settings, …).
 *   - refreshToken  — opaque; exchanges for a fresh identity token.
 *
 * All persisted in localStorage under the `stackup.*` namespace. Every
 * storage/`window` touch is guarded so the static export renders on the
 * server without a DOM.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

/* ------------------------------------------------------------------ *
 * Shared types (mirror the API contract exactly).
 * ------------------------------------------------------------------ */
export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
}

export type WorkspaceRole = "owner" | "admin" | "member" | "guest";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  color: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
}

export interface Member {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  status: string;
}

/* ------------------------------------------------------------------ *
 * Storage that never throws. Private-browsing modes can block
 * localStorage entirely — degrade to an in-memory map rather than crash.
 * ------------------------------------------------------------------ */
const KEYS = {
  identity: "stackup.identityToken",
  refresh: "stackup.refreshToken",
  access: "stackup.accessToken",
  workspace: "stackup.workspace",
  user: "stackup.user",
} as const;

const mem = new Map<string, string>();
function rawGet(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? mem.get(key) ?? null;
  } catch {
    return mem.get(key) ?? null;
  }
}
function rawSet(key: string, value: string): void {
  mem.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* in-memory only */
  }
}
function rawDel(key: string): void {
  mem.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const getIdentityToken = (): string | null => rawGet(KEYS.identity);
export const setIdentityToken = (t: string): void => rawSet(KEYS.identity, t);
export const getRefreshToken = (): string | null => rawGet(KEYS.refresh);
export const setRefreshToken = (t: string): void => rawSet(KEYS.refresh, t);
export const getAccessToken = (): string | null => rawGet(KEYS.access);
export const setAccessToken = (t: string): void => rawSet(KEYS.access, t);

export function getWorkspace(): WorkspaceSummary | null {
  const raw = rawGet(KEYS.workspace);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WorkspaceSummary;
  } catch {
    return null;
  }
}
export function setWorkspace(ws: WorkspaceSummary): void {
  rawSet(KEYS.workspace, JSON.stringify(ws));
}

export function getUser(): PublicUser | null {
  const raw = rawGet(KEYS.user);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PublicUser;
  } catch {
    return null;
  }
}
export function setUser(u: PublicUser): void {
  rawSet(KEYS.user, JSON.stringify(u));
}

/** Clear the whole session. */
export function clearTokens(): void {
  for (const k of Object.values(KEYS)) rawDel(k);
}
/** Drop only the workspace-scoped session (keeps the identity/login). */
export function clearWorkspace(): void {
  rawDel(KEYS.access);
  rawDel(KEYS.workspace);
}

/* ------------------------------------------------------------------ *
 * Fetch wrapper.
 * ------------------------------------------------------------------ */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type AuthMode = "identity" | "access" | "none";

export interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Which token to attach. Defaults to the workspace access token. */
  auth?: AuthMode;
}

function tokenFor(auth: AuthMode): string | null {
  if (auth === "none") return null;
  if (auth === "identity") return getIdentityToken();
  return getAccessToken();
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const auth: AuthMode = opts.auth ?? "access";
  const token = tokenFor(auth);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(
      0,
      "Can't reach StackUp. Check your connection and try again.",
    );
  }

  // Session expired on an authed call — clear and bounce to login.
  if (res.status === 401 && auth !== "none") {
    clearTokens();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }

  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "message" in data
        ? Array.isArray((data as { message: unknown }).message)
          ? ((data as { message: unknown[] }).message as unknown[]).join(", ")
          : String((data as { message: unknown }).message)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

/* ------------------------------------------------------------------ *
 * Endpoint wrappers.
 * ------------------------------------------------------------------ */
interface AuthResult {
  identityToken: string;
  refreshToken: string;
  user: PublicUser;
  workspaces: WorkspaceSummary[];
}

export const authApi = {
  signup: (body: { email: string; fullName: string; password: string }) =>
    api<AuthResult>("/auth/signup", { method: "POST", body, auth: "none" }),
  login: (body: { email: string; password: string }) =>
    api<AuthResult>("/auth/login", { method: "POST", body, auth: "none" }),
  refresh: (refreshToken: string) =>
    api<{ identityToken: string; refreshToken: string }>("/auth/refresh", {
      method: "POST",
      body: { refreshToken },
      auth: "none",
    }),
  me: () => api<{ user: PublicUser }>("/auth/me", { auth: "identity" }),
};

export const workspacesApi = {
  list: () =>
    api<{ workspaces: WorkspaceSummary[] }>("/workspaces", { auth: "identity" }),
  create: (name: string) =>
    api<{ workspace: WorkspaceSummary }>("/workspaces", {
      method: "POST",
      body: { name },
      auth: "identity",
    }),
  selectToken: (id: string) =>
    api<{ accessToken: string; workspace: WorkspaceSummary }>(
      `/workspaces/${id}/token`,
      { method: "POST", auth: "identity" },
    ),
  current: () =>
    api<{ workspace: WorkspaceSummary; role: WorkspaceRole }>(
      "/workspaces/current",
      { auth: "access" },
    ),
  members: () =>
    api<{ members: Member[] }>("/workspaces/current/members", {
      auth: "access",
    }),
  invite: (body: { email: string; role: WorkspaceRole }) =>
    api<Member>("/workspaces/current/members", {
      method: "POST",
      body,
      auth: "access",
    }),
};
