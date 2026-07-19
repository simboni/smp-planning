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
 * Teams (Module 2): named groups of members, shareable as a principal.
 * ------------------------------------------------------------------ */
export interface Team {
  id: string;
  name: string;
  color: string;
  memberCount: number;
}

export interface TeamMember {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
}

export interface TeamDetail {
  team: { id: string; name: string; color: string };
  members: TeamMember[];
}

/* ------------------------------------------------------------------ *
 * Space sharing (Module 2): privacy + per-principal grants.
 * ------------------------------------------------------------------ */
export interface AccessEntry {
  principalType: "user" | "team";
  principalId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  permission: Permission;
}

export interface SpaceAccess {
  isPrivate: boolean;
  /** Whether the current user may change privacy / shares. */
  canManage: boolean;
  entries: AccessEntry[];
}

/* ------------------------------------------------------------------ *
 * Access & permissions (Module 2).
 * Ordering: view < comment < edit < full.
 * ------------------------------------------------------------------ */
export type Permission = "view" | "comment" | "edit" | "full";

/** Rank a permission so the UI can compare (e.g. "at least edit"). */
export const PERMISSION_RANK: Record<Permission, number> = {
  view: 0,
  comment: 1,
  edit: 2,
  full: 3,
};

/** Human label for a permission level. */
export const PERMISSION_LABEL: Record<Permission, string> = {
  view: "View",
  comment: "Comment",
  edit: "Edit",
  full: "Full",
};

/** True when `have` grants at least `need`. */
export function permissionAtLeast(have: Permission, need: Permission): boolean {
  return PERMISSION_RANK[have] >= PERMISSION_RANK[need];
}

/* ------------------------------------------------------------------ *
 * Hierarchy (Module 1): Spaces → Folders → Lists.
 * ------------------------------------------------------------------ */
export interface Space {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  isPrivate: boolean;
  archived: boolean;
  sortOrder: number;
  /** The current user's effective permission on this space (Module 2). */
  myPermission: Permission;
}

export interface Folder {
  id: string;
  spaceId: string;
  name: string;
  archived: boolean;
  sortOrder: number;
}

export interface List {
  id: string;
  spaceId: string;
  folderId: string | null;
  name: string;
  color: string | null;
  archived: boolean;
  sortOrder: number;
}

/** A folder with its nested lists (as returned inside the tree). */
export interface FolderWithLists extends Folder {
  lists: List[];
}

/** A space with its folders (each carrying lists) and folderless lists. */
export interface SpaceTree extends Space {
  folders: FolderWithLists[];
  lists: List[];
}

export interface HierarchyTree {
  spaces: SpaceTree[];
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

/* ------------------------------------------------------------------ *
 * Hierarchy endpoints — all workspace-scoped (access token).
 * ------------------------------------------------------------------ */
export const hierarchyApi = {
  /** The whole tree in one shot — spaces → folders → lists. */
  getTree: () => api<HierarchyTree>("/hierarchy", { auth: "access" }),

  listSpaces: () => api<{ spaces: Space[] }>("/spaces", { auth: "access" }),
  createSpace: (body: {
    name: string;
    color?: string;
    icon?: string | null;
    isPrivate?: boolean;
  }) => api<{ space: Space }>("/spaces", { method: "POST", body, auth: "access" }),
  updateSpace: (
    id: string,
    body: {
      name?: string;
      color?: string;
      icon?: string | null;
      isPrivate?: boolean;
      archived?: boolean;
    },
  ) =>
    api<{ space: Space }>(`/spaces/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  deleteSpace: (id: string) =>
    api<void>(`/spaces/${id}`, { method: "DELETE", auth: "access" }),
  getSpace: (id: string) =>
    api<{ space: Space; folders: FolderWithLists[]; lists: List[] }>(
      `/spaces/${id}`,
      { auth: "access" },
    ),

  createFolder: (spaceId: string, body: { name: string }) =>
    api<{ folder: Folder }>(`/spaces/${spaceId}/folders`, {
      method: "POST",
      body,
      auth: "access",
    }),
  updateFolder: (id: string, body: { name?: string; archived?: boolean }) =>
    api<{ folder: Folder }>(`/folders/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  deleteFolder: (id: string) =>
    api<void>(`/folders/${id}`, { method: "DELETE", auth: "access" }),

  createList: (
    spaceId: string,
    body: { name: string; folderId?: string | null; color?: string | null },
  ) =>
    api<{ list: List }>(`/spaces/${spaceId}/lists`, {
      method: "POST",
      body,
      auth: "access",
    }),
  updateList: (
    id: string,
    body: {
      name?: string;
      color?: string | null;
      archived?: boolean;
      folderId?: string | null;
    },
  ) =>
    api<{ list: List }>(`/lists/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  deleteList: (id: string) =>
    api<void>(`/lists/${id}`, { method: "DELETE", auth: "access" }),
  getList: (id: string) =>
    api<{
      list: List;
      space: { id: string; name: string; color: string; icon: string | null };
      folder: { id: string; name: string } | null;
    }>(`/lists/${id}`, { auth: "access" }),

  reorderSpaces: (ids: string[]) =>
    api<{ ok: true }>("/spaces/reorder", {
      method: "POST",
      body: { ids },
      auth: "access",
    }),
  reorderFolders: (spaceId: string, ids: string[]) =>
    api<{ ok: true }>("/folders/reorder", {
      method: "POST",
      body: { spaceId, ids },
      auth: "access",
    }),
  reorderLists: (
    spaceId: string,
    folderId: string | null,
    ids: string[],
  ) =>
    api<{ ok: true }>("/lists/reorder", {
      method: "POST",
      body: { spaceId, folderId, ids },
      auth: "access",
    }),
};

/* ------------------------------------------------------------------ *
 * Teams — workspace-scoped groups (Module 2). Owner/admin may mutate.
 * ------------------------------------------------------------------ */
export const teamsApi = {
  list: () => api<{ teams: Team[] }>("/teams", { auth: "access" }),
  get: (id: string) => api<TeamDetail>(`/teams/${id}`, { auth: "access" }),
  create: (body: { name: string; color?: string; memberUserIds?: string[] }) =>
    api<{ team: Team }>("/teams", { method: "POST", body, auth: "access" }),
  update: (id: string, body: { name?: string; color?: string }) =>
    api<{ team: Team }>(`/teams/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/teams/${id}`, { method: "DELETE", auth: "access" }),
  addMember: (id: string, userId: string) =>
    api<unknown>(`/teams/${id}/members`, {
      method: "POST",
      body: { userId },
      auth: "access",
    }),
  removeMember: (id: string, userId: string) =>
    api<void>(`/teams/${id}/members/${userId}`, {
      method: "DELETE",
      auth: "access",
    }),
};

/* ------------------------------------------------------------------ *
 * Space access / sharing (Module 2).
 * ------------------------------------------------------------------ */
export const accessApi = {
  getSpaceAccess: (spaceId: string) =>
    api<SpaceAccess>(`/spaces/${spaceId}/access`, { auth: "access" }),
  setPrivacy: (spaceId: string, isPrivate: boolean) =>
    api<{ isPrivate: boolean }>(`/spaces/${spaceId}/privacy`, {
      method: "PUT",
      body: { isPrivate },
      auth: "access",
    }),
  upsertShare: (
    spaceId: string,
    body: {
      principalType: "user" | "team";
      principalId: string;
      permission: Permission;
    },
  ) =>
    api<{ entry: AccessEntry }>(`/spaces/${spaceId}/shares`, {
      method: "PUT",
      body,
      auth: "access",
    }),
  removeShare: (
    spaceId: string,
    principalType: "user" | "team",
    principalId: string,
  ) =>
    api<void>(`/spaces/${spaceId}/shares/${principalType}/${principalId}`, {
      method: "DELETE",
      auth: "access",
    }),
};
