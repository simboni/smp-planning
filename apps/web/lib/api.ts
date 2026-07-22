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
  /** Assigned custom role id (M17), or null. */
  customRoleId?: string | null;
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
 * Tasks Core (Module 3): Statuses, Tags, Tasks, Checklists.
 * ------------------------------------------------------------------ */
export type StatusType = "not_started" | "active" | "done";

export interface Status {
  id: string;
  name: string;
  color: string;
  type: StatusType;
  position: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export type Priority = "urgent" | "high" | "normal" | "low";

/** A person referenced from a task (assignee / watcher / author). */
export interface TaskUser {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

/** The denormalized status carried on every card. */
export interface TaskStatusRef {
  id: string;
  name: string;
  color: string;
  type: StatusType;
}

export interface TaskCard {
  id: string;
  listId: string;
  spaceId: string;
  parentTaskId: string | null;
  name: string;
  statusId: string;
  status: TaskStatusRef;
  priority: Priority | null;
  startDate: string | null;
  dueDate: string | null;
  timeEstimateMinutes: number | null;
  position: number;
  assignees: TaskUser[];
  tags: Tag[];
  subtaskCount: number;
  checklistTotal: number;
  checklistDone: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Module 4: number of unresolved tasks this task is waiting on. */
  blockedCount: number;
  /** Module 4: the task's type ("Task" when null). */
  taskType: TaskTypeRef | null;
  /** Module 4: milestone flag (renders as a purple diamond). */
  isMilestone: boolean;
  /** Module 8: total tracked seconds across all users' time entries. */
  trackedSeconds: number;
  /** Module 10: sprint/story points (0..999, null = unset). */
  sprintPoints: number | null;
}

/* ------------------------------------------------------------------ *
 * Module 4 — Custom fields, dependencies, task types & recurrence.
 * ------------------------------------------------------------------ */
export type CustomFieldType =
  | "text"
  | "number"
  | "money"
  | "date"
  | "dropdown"
  | "labels"
  | "checkbox"
  | "url"
  | "email"
  | "phone"
  | "rating"
  | "progress";

/** Human labels for the field types (pickers, manager rows). */
export const FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  money: "Money",
  date: "Date",
  dropdown: "Dropdown",
  labels: "Labels",
  checkbox: "Checkbox",
  url: "URL",
  email: "Email",
  phone: "Phone",
  rating: "Rating",
  progress: "Progress",
};

export interface FieldOption {
  id: string;
  name: string;
  color: string;
}

/** Per-type config: dropdown/labels carry options, money a currency, rating a max. */
export interface CustomFieldConfig {
  options?: FieldOption[];
  currency?: string;
  max?: number;
}

export interface CustomFieldDef {
  id: string;
  name: string;
  type: CustomFieldType;
  config: CustomFieldConfig;
  position: number;
}

/**
 * A field value payload. Shape follows the field type:
 * text/url/email/phone → {text}; number/money/rating/progress → {number};
 * date → {date}; checkbox → {checked}; dropdown → {optionId};
 * labels → {optionIds}. `null` means unset.
 */
export type FieldValue =
  | { text: string }
  | { number: number }
  | { date: string }
  | { checked: boolean }
  | { optionId: string }
  | { optionIds: string[] };

/** A space field merged with this task's value (on TaskDetail.fields). */
export interface TaskFieldEntry {
  fieldId: string;
  name: string;
  type: CustomFieldType;
  config: CustomFieldConfig;
  value: FieldValue | null;
}

/** A lightweight reference to another task (dependencies & links). */
export interface TaskRef {
  id: string;
  name: string;
  status: TaskStatusRef | null;
  listId: string;
}

/** The denormalized task type carried on cards & detail. */
export interface TaskTypeRef {
  id: string;
  name: string;
  icon: string | null;
  isMilestone: boolean;
}

/** A space-level task type definition. */
export interface TaskType {
  id: string;
  name: string;
  icon: string | null;
  isMilestone: boolean;
}

export type RecurrenceFreq = "daily" | "weekly" | "monthly";

export interface Recurrence {
  freq: RecurrenceFreq;
  interval: number;
  mode: "on_complete";
}

export interface ChecklistItem {
  id: string;
  name: string;
  resolved: boolean;
  assigneeUserId: string | null;
  position: number;
}

export interface Checklist {
  id: string;
  name: string;
  position: number;
  items: ChecklistItem[];
}

export interface TaskBreadcrumb {
  space: { id: string; name: string; color: string; icon: string | null };
  folder: { id: string; name: string } | null;
  list: { id: string; name: string };
}

export interface TaskDetail extends TaskCard {
  description: string | null;
  watchers: TaskUser[];
  subtasks: TaskCard[];
  checklists: Checklist[];
  createdBy: TaskUser | null;
  breadcrumb: TaskBreadcrumb;
  /** Module 4: every space field with this task's value (null = unset). */
  fields: TaskFieldEntry[];
  /** Module 4: tasks this task waits on (its blockers). */
  waitingOn: TaskRef[];
  /** Module 4: tasks that wait on this task. */
  blocking: TaskRef[];
  /** Module 4: symmetric linked tasks. */
  linked: TaskRef[];
  /** Module 4: recurrence rule (spawns a clone on completion). */
  recurrence: Recurrence | null;
}

/** Body for creating a task (top-level or subtask). */
export interface TaskCreateBody {
  name: string;
  statusId?: string;
  priority?: Priority | null;
  assigneeIds?: string[];
  tagIds?: string[];
  startDate?: string | null;
  dueDate?: string | null;
  timeEstimateMinutes?: number | null;
  description?: string | null;
  parentTaskId?: string | null;
}

/** Body for patching a task's own fields (relations have dedicated calls). */
export interface TaskUpdateBody {
  name?: string;
  statusId?: string;
  priority?: Priority | null;
  startDate?: string | null;
  dueDate?: string | null;
  timeEstimateMinutes?: number | null;
  description?: string | null;
  archived?: boolean;
  taskTypeId?: string | null;
  isMilestone?: boolean;
  recurrence?: Recurrence | null;
  /** Module 10: sprint/story points (0..999, null clears). */
  sprintPoints?: number | null;
}

/* ------------------------------------------------------------------ *
 * Views Engine (Module 5): saved views per list.
 * ------------------------------------------------------------------ */
export type ViewKind = "list" | "board" | "calendar" | "table" | "gantt" | "timeline";

export interface ViewFilters {
  statusIds?: string[];
  assigneeIds?: string[];
  priorities?: Priority[];
  tagIds?: string[];
  /** Default true — matches the classic List behavior of showing done. */
  includeDone?: boolean;
}

export type ViewSortKey = "name" | "dueDate" | "priority" | "created" | "position";

export interface ViewSort {
  key: ViewSortKey;
  dir: "asc" | "desc";
}

export type ViewGroupBy = "status" | "assignee" | "priority" | null;

/** Client-owned view configuration blob (the API stores it opaquely). */
export interface ViewConfig {
  filters?: ViewFilters;
  sort?: ViewSort | null;
  groupBy?: ViewGroupBy;
}

export interface View {
  id: string;
  name: string;
  kind: ViewKind;
  config: ViewConfig;
  isShared: boolean;
  position: number;
  createdBy: string;
}

/** Human labels + accent colors for the four priorities. */
export const PRIORITY_META: Record<
  Priority,
  { label: string; color: string }
> = {
  urgent: { label: "Urgent", color: "#E5484D" },
  high: { label: "High", color: "#F5A623" },
  normal: { label: "Normal", color: "#2B62C4" },
  low: { label: "Low", color: "#8A8F9C" },
};
export const PRIORITY_ORDER: Priority[] = ["urgent", "high", "normal", "low"];

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
  /** Extra request headers merged into the defaults. */
  headers?: Record<string, string>;
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
        ...(opts.headers ?? {}),
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

/** login/signup return tokens, OR a 2FA challenge when the account has 2FA on. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
}
export type LoginResult = AuthResult | TwoFactorChallenge;
export const isTwoFactorChallenge = (r: LoginResult): r is TwoFactorChallenge =>
  (r as TwoFactorChallenge).twoFactorRequired === true;

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  current: boolean;
}

export const authApi = {
  signup: (body: { email: string; fullName: string; password: string }) =>
    api<AuthResult>("/auth/signup", { method: "POST", body, auth: "none" }),
  login: (body: { email: string; password: string }) =>
    api<LoginResult>("/auth/login", { method: "POST", body, auth: "none" }),
  /** Second step when login returns a 2FA challenge. */
  login2fa: (challengeToken: string, code: string) =>
    api<AuthResult>("/auth/2fa/login", {
      method: "POST",
      body: { challengeToken, code },
      auth: "none",
    }),
  refresh: (refreshToken: string) =>
    api<{ identityToken: string; refreshToken: string }>("/auth/refresh", {
      method: "POST",
      body: { refreshToken },
      auth: "none",
    }),
  me: () => api<{ user: PublicUser }>("/auth/me", { auth: "identity" }),
  /** Update the caller's own profile (display name and/or avatar photo). */
  updateProfile: (body: { fullName?: string; avatarUrl?: string | null }) =>
    api<{ user: PublicUser }>("/auth/me", {
      method: "PATCH",
      body,
      auth: "identity",
    }),
  /** Revoke the given refresh token server-side (best-effort on sign-out). */
  logout: (refreshToken: string) =>
    api<void>("/auth/logout", {
      method: "POST",
      body: { refreshToken },
      auth: "none",
    }),
  /** Request a password-reset email (always resolves — never reveals if the
   * address exists). */
  forgotPassword: (email: string) =>
    api<{ ok: true }>("/auth/forgot-password", {
      method: "POST",
      body: { email },
      auth: "none",
    }),
  /** Complete a reset with the emailed token + a new password. */
  resetPassword: (token: string, password: string) =>
    api<{ ok: true }>("/auth/reset-password", {
      method: "POST",
      body: { token, password },
      auth: "none",
    }),
  /** Which SSO providers are enabled (M18). */
  ssoProviders: () =>
    api<{ google: boolean }>("/auth/sso/providers", { auth: "none" }),
};

/** Absolute URL that kicks off the Google OAuth flow (full-page navigation). */
export const googleSsoStartUrl = `${API_BASE}/auth/oauth/google/start`;

/* ---- Module 16: Account security (2FA + sessions) ----------------- */
export const securityApi = {
  twoFactorStatus: () =>
    api<{ enabled: boolean }>("/auth/2fa/status", { auth: "identity" }),
  enroll2fa: () =>
    api<{ otpauthUri: string; qrDataUrl: string }>("/auth/2fa/enroll", {
      method: "POST",
      auth: "identity",
    }),
  enable2fa: (code: string) =>
    api<{ enabled: true }>("/auth/2fa/enable", {
      method: "POST",
      body: { code },
      auth: "identity",
    }),
  disable2fa: (code: string) =>
    api<{ enabled: false }>("/auth/2fa/disable", {
      method: "POST",
      body: { code },
      auth: "identity",
    }),
  listSessions: () =>
    api<{ sessions: SessionInfo[] }>("/auth/sessions", {
      auth: "identity",
      headers: { "x-refresh-token": getRefreshToken() ?? "" },
    }),
  revokeSession: (id: string) =>
    api<void>(`/auth/sessions/${id}`, { method: "DELETE", auth: "identity" }),
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
  /** Change a member's role or suspend / reactivate them. Owner/admin only. */
  updateMember: (
    userId: string,
    body: { role?: WorkspaceRole; status?: "active" | "suspended" },
  ) =>
    api<Member>(`/workspaces/current/members/${userId}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  /** Remove a member from the workspace. Owner/admin only. */
  removeMember: (userId: string) =>
    api<void>(`/workspaces/current/members/${userId}`, {
      method: "DELETE",
      auth: "access",
    }),
  /** Update workspace branding (name / accent color / logo). Admin only. */
  update: (body: { name?: string; color?: string; avatarUrl?: string | null }) =>
    api<{ workspace: WorkspaceSummary }>("/workspaces/current", {
      method: "PATCH",
      body,
      auth: "access",
    }),
  /** Permanently delete the current workspace and everything in it. Owner only. */
  remove: () =>
    api<void>("/workspaces/current", { method: "DELETE", auth: "access" }),
};

/* ------------------------------------------------------------------ *
 * Governance (Module 17): custom roles + audit log viewer.
 * ------------------------------------------------------------------ */
export const CAPABILITIES = [
  "createSpaces",
  "deleteItems",
  "createDocs",
  "manageAutomations",
  "exportData",
  "viewAuditLog",
  "manageMembers",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  createSpaces: "Create Spaces",
  deleteItems: "Delete items (Spaces, Folders, Lists, Tasks)",
  createDocs: "Create Docs",
  manageAutomations: "Create & manage Automations",
  exportData: "Export workspace data",
  viewAuditLog: "View the audit log",
  manageMembers: "Invite & manage members",
};

/** Baseline capabilities for the two assignable base roles (UI defaults). */
export const BASE_ROLE_CAPABILITIES: Record<"member" | "guest", Record<Capability, boolean>> = {
  member: {
    createSpaces: true,
    deleteItems: true,
    createDocs: true,
    manageAutomations: true,
    exportData: false,
    viewAuditLog: false,
    manageMembers: false,
  },
  guest: {
    createSpaces: false,
    deleteItems: false,
    createDocs: false,
    manageAutomations: false,
    exportData: false,
    viewAuditLog: false,
    manageMembers: false,
  },
};

export interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  baseRole: "member" | "guest";
  capabilities: Partial<Record<Capability, boolean>>;
  memberCount: number;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface AuditIntegrity {
  ok: boolean;
  checked: number;
  brokenAt: string | null;
}

export const governanceApi = {
  listRoles: () =>
    api<{ roles: CustomRole[] }>("/governance/roles", { auth: "access" }),
  createRole: (body: {
    name: string;
    description?: string;
    baseRole: "member" | "guest";
    capabilities: Partial<Record<Capability, boolean>>;
  }) =>
    api<{ role: CustomRole }>("/governance/roles", {
      method: "POST",
      body,
      auth: "access",
    }),
  updateRole: (
    id: string,
    body: {
      name?: string;
      description?: string;
      capabilities?: Partial<Record<Capability, boolean>>;
    },
  ) =>
    api<{ role: CustomRole }>(`/governance/roles/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  deleteRole: (id: string) =>
    api<void>(`/governance/roles/${id}`, { method: "DELETE", auth: "access" }),
  assignRole: (userId: string, customRoleId: string | null) =>
    api<void>(`/governance/members/${userId}/role`, {
      method: "POST",
      body: { customRoleId },
      auth: "access",
    }),
  listAudit: (opts: {
    limit?: number;
    cursor?: string;
    action?: string;
    entity?: string;
    actorUserId?: string;
  } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.cursor) q.set("cursor", opts.cursor);
    if (opts.action) q.set("action", opts.action);
    if (opts.entity) q.set("entity", opts.entity);
    if (opts.actorUserId) q.set("actorUserId", opts.actorUserId);
    const qs = q.toString();
    return api<{ events: AuditEvent[]; nextCursor: string | null }>(
      `/audit${qs ? `?${qs}` : ""}`,
      { auth: "access" },
    );
  },
  verifyAudit: () =>
    api<AuditIntegrity>("/audit/verify", { auth: "access" }),
};

/* ------------------------------------------------------------------ *
 * Limits & metering (Module 20).
 * ------------------------------------------------------------------ */
export interface Meter {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
}
export interface UsageReport {
  storage: Meter & { usedBytes: number; limitBytes: number };
  automations: Meter & { periodStart: string };
}

export const limitsApi = {
  usage: () => api<UsageReport>("/limits/usage", { auth: "access" }),
};

/* ------------------------------------------------------------------ *
 * Pricing plans (Module 24).
 * ------------------------------------------------------------------ */
export type PlanId = "free" | "unlimited" | "business" | "enterprise";

export interface PlanDef {
  id: PlanId;
  name: string;
  /** USD per member per month; 0 = free, null = "contact us". */
  pricePerMemberMonth: number | null;
  tagline: string;
  storageBytes: number;
  automationsPerMonth: number;
  features: Record<string, boolean>;
  highlights: string[];
}

export const plansApi = {
  list: () =>
    api<{ plans: PlanDef[]; current: PlanId }>("/plans", { auth: "access" }),
  select: (plan: PlanId) =>
    api<{ plan: PlanId }>("/plans/select", {
      method: "POST",
      body: { plan },
      auth: "access",
    }),
};

/* ------------------------------------------------------------------ *
 * Comms & integrations (Module 22): email provider + Slack webhook.
 * ------------------------------------------------------------------ */
export interface EmailStatus {
  provider: string;
  configured: boolean;
}

export interface SlackConfig {
  configured: boolean;
  webhookPreview: string | null;
  events: string[];
  active: boolean;
}

export const commsApi = {
  emailStatus: () => api<EmailStatus>("/integrations/email", { auth: "access" }),
  getSlack: () => api<SlackConfig>("/integrations/slack", { auth: "access" }),
  setSlack: (body: { webhookUrl: string; events?: string[]; active?: boolean }) =>
    api<SlackConfig>("/integrations/slack", {
      method: "PUT",
      body,
      auth: "access",
    }),
  removeSlack: () =>
    api<void>("/integrations/slack", { method: "DELETE", auth: "access" }),
  testSlack: () =>
    api<{ ok: boolean; detail: string }>("/integrations/slack/test", {
      method: "POST",
      auth: "access",
    }),
  testEmail: (to: string) =>
    api<{ ok: boolean; provider: string; detail: string }>(
      "/integrations/email/test",
      { method: "POST", body: { to }, auth: "access" },
    ),
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

/* ------------------------------------------------------------------ *
 * Statuses — per-space task workflow columns (Module 3).
 * ------------------------------------------------------------------ */
export const statusesApi = {
  list: (spaceId: string) =>
    api<{ statuses: Status[] }>(`/spaces/${spaceId}/statuses`, {
      auth: "access",
    }),
  create: (
    spaceId: string,
    body: { name: string; color?: string; type?: StatusType },
  ) =>
    api<{ status: Status }>(`/spaces/${spaceId}/statuses`, {
      method: "POST",
      body,
      auth: "access",
    }),
  update: (
    id: string,
    body: { name?: string; color?: string; type?: StatusType },
  ) =>
    api<{ status: Status }>(`/statuses/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/statuses/${id}`, { method: "DELETE", auth: "access" }),
  reorder: (spaceId: string, ids: string[]) =>
    api<{ ok: true }>(`/spaces/${spaceId}/statuses/reorder`, {
      method: "POST",
      body: { ids },
      auth: "access",
    }),
};

/* ------------------------------------------------------------------ *
 * Tags — per-space labels (Module 3).
 * ------------------------------------------------------------------ */
export const tagsApi = {
  list: (spaceId: string) =>
    api<{ tags: Tag[] }>(`/spaces/${spaceId}/tags`, { auth: "access" }),
  create: (spaceId: string, body: { name: string; color?: string }) =>
    api<{ tag: Tag }>(`/spaces/${spaceId}/tags`, {
      method: "POST",
      body,
      auth: "access",
    }),
  update: (id: string, body: { name?: string; color?: string }) =>
    api<{ tag: Tag }>(`/tags/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/tags/${id}`, { method: "DELETE", auth: "access" }),
};

/* ------------------------------------------------------------------ *
 * Tasks — the core of Module 3. Cards, detail, relations & checklists.
 * ------------------------------------------------------------------ */
export const tasksApi = {
  /** Top-level tasks for a list (subtasks come nested in the detail). */
  listForList: (listId: string) =>
    api<{ tasks: TaskCard[] }>(`/lists/${listId}/tasks`, { auth: "access" }),
  create: (listId: string, body: TaskCreateBody) =>
    api<{ task: TaskDetail }>(`/lists/${listId}/tasks`, {
      method: "POST",
      body,
      auth: "access",
    }),
  get: (id: string) =>
    api<{ task: TaskDetail }>(`/tasks/${id}`, { auth: "access" }),
  update: (id: string, body: TaskUpdateBody) =>
    api<{ task: TaskDetail; spawnedTaskId?: string }>(`/tasks/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/tasks/${id}`, { method: "DELETE", auth: "access" }),
  createSubtask: (id: string, body: { name: string }) =>
    api<{ task: TaskCard }>(`/tasks/${id}/subtasks`, {
      method: "POST",
      body,
      auth: "access",
    }),
  reorder: (listId: string, statusId: string, ids: string[]) =>
    api<{ ok: true }>(`/lists/${listId}/tasks/reorder`, {
      method: "POST",
      body: { statusId, ids },
      auth: "access",
    }),

  /* relations -------------------------------------------------------- */
  addAssignee: (id: string, userId: string) =>
    api<unknown>(`/tasks/${id}/assignees`, {
      method: "POST",
      body: { userId },
      auth: "access",
    }),
  removeAssignee: (id: string, userId: string) =>
    api<void>(`/tasks/${id}/assignees/${userId}`, {
      method: "DELETE",
      auth: "access",
    }),
  addWatcher: (id: string, userId: string) =>
    api<unknown>(`/tasks/${id}/watchers`, {
      method: "POST",
      body: { userId },
      auth: "access",
    }),
  removeWatcher: (id: string, userId: string) =>
    api<void>(`/tasks/${id}/watchers/${userId}`, {
      method: "DELETE",
      auth: "access",
    }),
  addTag: (id: string, tagId: string) =>
    api<unknown>(`/tasks/${id}/tags`, {
      method: "POST",
      body: { tagId },
      auth: "access",
    }),
  removeTag: (id: string, tagId: string) =>
    api<void>(`/tasks/${id}/tags/${tagId}`, {
      method: "DELETE",
      auth: "access",
    }),

  /* checklists ------------------------------------------------------- */
  createChecklist: (taskId: string, body: { name?: string } = {}) =>
    api<{ checklist: Checklist }>(`/tasks/${taskId}/checklists`, {
      method: "POST",
      body,
      auth: "access",
    }),
  updateChecklist: (id: string, body: { name?: string }) =>
    api<{ checklist: Checklist }>(`/checklists/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  removeChecklist: (id: string) =>
    api<void>(`/checklists/${id}`, { method: "DELETE", auth: "access" }),
  createChecklistItem: (checklistId: string, body: { name: string }) =>
    api<{ item: ChecklistItem }>(`/checklists/${checklistId}/items`, {
      method: "POST",
      body,
      auth: "access",
    }),
  updateChecklistItem: (
    id: string,
    body: { name?: string; resolved?: boolean; assigneeUserId?: string | null },
  ) =>
    api<{ item: ChecklistItem }>(`/checklist-items/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  removeChecklistItem: (id: string) =>
    api<void>(`/checklist-items/${id}`, { method: "DELETE", auth: "access" }),
};

/* ------------------------------------------------------------------ *
 * Custom fields — per-space definitions + per-task values (Module 4).
 * ------------------------------------------------------------------ */
export const fieldsApi = {
  spaceFields: (spaceId: string) =>
    api<{ fields: CustomFieldDef[] }>(`/spaces/${spaceId}/fields`, {
      auth: "access",
    }),
  createField: (
    spaceId: string,
    body: { name: string; type: CustomFieldType; config?: CustomFieldConfig },
  ) =>
    api<{ field: CustomFieldDef }>(`/spaces/${spaceId}/fields`, {
      method: "POST",
      body,
      auth: "access",
    }),
  updateField: (
    id: string,
    body: { name?: string; config?: CustomFieldConfig; position?: number },
  ) =>
    api<{ field: CustomFieldDef }>(`/fields/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  deleteField: (id: string) =>
    api<void>(`/fields/${id}`, { method: "DELETE", auth: "access" }),
  /** Set (or clear with null) a task's value for one field. */
  setTaskField: (taskId: string, fieldId: string, value: FieldValue | null) =>
    api<unknown>(`/tasks/${taskId}/fields/${fieldId}`, {
      method: "PUT",
      body: { value },
      auth: "access",
    }),
};

/* ------------------------------------------------------------------ *
 * Dependencies & links between tasks (Module 4).
 * ------------------------------------------------------------------ */
export const relationsApi = {
  /** Make `taskId` wait on `dependsOnTaskId`. */
  addDependency: (taskId: string, dependsOnTaskId: string) =>
    api<unknown>(`/tasks/${taskId}/dependencies`, {
      method: "POST",
      body: { dependsOnTaskId },
      auth: "access",
    }),
  removeDependency: (taskId: string, depId: string) =>
    api<void>(`/tasks/${taskId}/dependencies/${depId}`, {
      method: "DELETE",
      auth: "access",
    }),
  /** Symmetric link between two tasks. */
  addLink: (taskId: string, otherTaskId: string) =>
    api<unknown>(`/tasks/${taskId}/links`, {
      method: "POST",
      body: { taskId: otherTaskId },
      auth: "access",
    }),
  removeLink: (taskId: string, otherTaskId: string) =>
    api<void>(`/tasks/${taskId}/links/${otherTaskId}`, {
      method: "DELETE",
      auth: "access",
    }),
};

/* ------------------------------------------------------------------ *
 * Saved views — per-list (Module 5). `config` is client-owned JSON.
 * ------------------------------------------------------------------ */
export const viewsApi = {
  list: (listId: string) =>
    api<{ views: View[] }>(`/lists/${listId}/views`, { auth: "access" }),
  create: (
    listId: string,
    body: { name: string; kind: ViewKind; config?: ViewConfig; isShared?: boolean },
  ) =>
    api<{ view: View }>(`/lists/${listId}/views`, {
      method: "POST",
      body,
      auth: "access",
    }),
  update: (
    id: string,
    body: {
      name?: string;
      config?: ViewConfig;
      isShared?: boolean;
      position?: number;
    },
  ) =>
    api<{ view: View }>(`/views/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/views/${id}`, { method: "DELETE", auth: "access" }),
};

/* ------------------------------------------------------------------ *
 * Module 6 — Real-time collaboration: comments, activity,
 * notifications, reminders & presence.
 * ------------------------------------------------------------------ */

/**
 * A task comment. Mentions are embedded in `body` as `@[userId]` tokens
 * (the UI renders them as @FullName chips via the workspace member list).
 * `assignee` non-null makes it an "assigned comment" that can be
 * resolved/reopened. Replies nest one level via `replies`.
 */
export interface TaskComment {
  id: string;
  parentCommentId: string | null;
  author: TaskUser;
  body: string;
  assignee: TaskUser | null;
  resolvedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  replies?: TaskComment[];
}

export type ActivityKind =
  | "created"
  | "status"
  | "priority"
  | "dates"
  | "assignee"
  | "name"
  | "description"
  | "archived"
  | "completed"
  | "comment";

/** One row of a task's activity feed. `data` shape depends on `kind`. */
export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  data: Record<string, unknown>;
  actor: TaskUser | null;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  kind: string;
  message: string;
  taskId: string | null;
  taskName: string | null;
  actor: TaskUser | null;
  readAt: string | null;
  createdAt: string;
}

export interface Reminder {
  id: string;
  note: string;
  remindAt: string;
  taskId: string | null;
  taskName: string | null;
  doneAt: string | null;
}

/** A workspace member currently connected to the event stream. */
export interface OnlineUser {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export const commentsApi = {
  list: (taskId: string) =>
    api<{ comments: TaskComment[] }>(`/tasks/${taskId}/comments`, {
      auth: "access",
    }),
  create: (
    taskId: string,
    body: { body: string; parentCommentId?: string; assigneeUserId?: string },
  ) =>
    api<{ comment: TaskComment }>(`/tasks/${taskId}/comments`, {
      method: "POST",
      body,
      auth: "access",
    }),
  update: (
    id: string,
    body: { body?: string; assigneeUserId?: string | null; resolved?: boolean },
  ) =>
    api<{ comment: TaskComment }>(`/comments/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/comments/${id}`, { method: "DELETE", auth: "access" }),
  activity: (taskId: string) =>
    api<{ activity: ActivityEntry[] }>(`/tasks/${taskId}/activity`, {
      auth: "access",
    }),
};

export const notificationsApi = {
  list: () =>
    api<{ notifications: AppNotification[]; unreadCount: number }>(
      "/notifications",
      { auth: "access" },
    ),
  markRead: (id: string) =>
    api<unknown>(`/notifications/${id}/read`, { method: "POST", auth: "access" }),
  markAllRead: () =>
    api<unknown>("/notifications/read-all", { method: "POST", auth: "access" }),
};

/** Native push-notification device tokens (Capacitor shell). */
export const pushApi = {
  register: (body: { token: string; platform: string }) =>
    api<unknown>("/push/tokens", { method: "POST", body, auth: "identity" }),
  unregister: (token: string) =>
    api<unknown>("/push/tokens", {
      method: "DELETE",
      body: { token },
      auth: "identity",
    }),
};

export const remindersApi = {
  list: () => api<{ reminders: Reminder[] }>("/reminders", { auth: "access" }),
  create: (body: { note: string; remindAt: string; taskId?: string }) =>
    api<{ reminder: Reminder }>("/reminders", {
      method: "POST",
      body,
      auth: "access",
    }),
  update: (
    id: string,
    body: { note?: string; remindAt?: string; done?: boolean },
  ) =>
    api<{ reminder: Reminder }>(`/reminders/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/reminders/${id}`, { method: "DELETE", auth: "access" }),
};

export const eventsApi = {
  /** Who is connected to the SSE stream right now. */
  online: () => api<{ online: OnlineUser[] }>("/events/online", { auth: "access" }),
};

/* ------------------------------------------------------------------ *
 * Module 7 — Docs, Wikis & Notepad.
 * ------------------------------------------------------------------ */

/** A doc as listed on the Docs home (page contents come separately). */
export interface Doc {
  id: string;
  name: string;
  icon: string | null;
  /** Space the doc is attached to; null = workspace-level (or private). */
  spaceId: string | null;
  spaceName: string | null;
  /** Only meaningful when unattached — a private doc is visible to its creator. */
  isPrivate: boolean;
  createdBy: string;
  pageCount: number;
  updatedAt: string;
}

/** A page as it appears in the doc's flat page list (no content). */
export interface DocPageMeta {
  id: string;
  parentPageId: string | null;
  title: string;
  position: number;
  updatedAt: string;
}

/** A full page including its sanitized HTML content. */
export interface DocPage {
  id: string;
  docId: string;
  parentPageId: string | null;
  title: string;
  /** Sanitized HTML (the server strips scripts). */
  content: string;
  position: number;
  updatedAt: string;
  updatedBy: string | null;
}

/** A personal scratch note (Notepad widget). */
export interface Note {
  id: string;
  content: string;
  updatedAt: string;
}

export const docsApi = {
  list: () => api<{ docs: Doc[] }>("/docs", { auth: "access" }),
  create: (body: {
    name: string;
    icon?: string | null;
    spaceId?: string | null;
    isPrivate?: boolean;
  }) => api<{ doc: Doc }>("/docs", { method: "POST", body, auth: "access" }),
  /** The doc plus its flat page list — build the tree client-side. */
  get: (id: string) =>
    api<{ doc: Doc; pages: DocPageMeta[] }>(`/docs/${id}`, { auth: "access" }),
  update: (
    id: string,
    body: {
      name?: string;
      icon?: string | null;
      spaceId?: string | null;
      isPrivate?: boolean;
    },
  ) => api<{ doc: Doc }>(`/docs/${id}`, { method: "PATCH", body, auth: "access" }),
  remove: (id: string) =>
    api<void>(`/docs/${id}`, { method: "DELETE", auth: "access" }),

  getPage: (pageId: string) =>
    api<{ page: DocPage }>(`/pages/${pageId}`, { auth: "access" }),
  createPage: (docId: string, body: { title?: string; parentPageId?: string | null }) =>
    api<{ page: DocPage }>(`/docs/${docId}/pages`, {
      method: "POST",
      body,
      auth: "access",
    }),
  updatePage: (
    pageId: string,
    body: {
      title?: string;
      content?: string;
      parentPageId?: string | null;
      position?: number;
    },
  ) =>
    api<{ page: DocPage }>(`/pages/${pageId}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  /** 400 when it's the doc's last page — a doc always keeps one. */
  removePage: (pageId: string) =>
    api<void>(`/pages/${pageId}`, { method: "DELETE", auth: "access" }),
};

export const notesApi = {
  list: () => api<{ notes: Note[] }>("/notes", { auth: "access" }),
  create: (body: { content: string }) =>
    api<{ note: Note }>("/notes", { method: "POST", body, auth: "access" }),
  update: (id: string, body: { content: string }) =>
    api<{ note: Note }>(`/notes/${id}`, { method: "PATCH", body, auth: "access" }),
  remove: (id: string) =>
    api<void>(`/notes/${id}`, { method: "DELETE", auth: "access" }),
};

/* ------------------------------------------------------------------ *
 * Module 8 — Time tracking, timesheets & workload.
 * ------------------------------------------------------------------ */

/** One tracked block of time on a task. `endedAt` null = still running. */
export interface TimeEntry {
  id: string;
  user: TaskUser;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  billable: boolean;
  note: string | null;
}

/** The caller's currently running timer (workspace-wide, one at most). */
export interface RunningTimer {
  entry: TimeEntry;
  task: { id: string; name: string; listId: string };
}

/** An entry as it appears inside a timesheet day (task denormalized). */
export interface TimesheetEntry {
  id: string;
  taskId: string;
  taskName: string;
  listId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  billable: boolean;
  note: string | null;
}

export interface TimesheetDay {
  date: string;
  totalSeconds: number;
  billableSeconds: number;
  entries: TimesheetEntry[];
}

export type TimesheetStatus = "submitted" | "approved" | "rejected";

export interface TimesheetSubmission {
  status: TimesheetStatus;
  decidedBy: TaskUser | string | null;
  decidedAt: string | null;
}

export interface MyTimesheet {
  weekStart: string;
  days: TimesheetDay[];
  totalSeconds: number;
  submission: TimesheetSubmission | null;
}

/** One member's week in the admin "Team" timesheet table. */
export interface TimesheetRow {
  user: TaskUser;
  totalSeconds: number;
  billableSeconds: number;
  submission: TimesheetSubmission | null;
}

/** A task inside a member's workload week. */
export interface WorkloadTask {
  id: string;
  name: string;
  listId: string;
  dueDate: string | null;
  estimateSeconds: number | null;
}

export interface WorkloadMember {
  user: TaskUser;
  capacitySeconds: number;
  assignedSeconds: number;
  trackedSeconds: number;
  tasks: WorkloadTask[];
}

export interface WorkloadWeek {
  weekStart: string;
  /** The 7 dates of the week (Monday-start), YYYY-MM-DD. */
  days: string[];
  members: WorkloadMember[];
}

export const timeApi = {
  /* timer ------------------------------------------------------------ */
  /** Start a timer on a task (the server auto-stops any prior one). */
  startTimer: (taskId: string, body: { note?: string; billable?: boolean } = {}) =>
    api<{ entry: TimeEntry }>(`/tasks/${taskId}/timer/start`, {
      method: "POST",
      body,
      auth: "access",
    }),
  stopTimer: () =>
    api<{ entry: TimeEntry }>("/timer/stop", { method: "POST", auth: "access" }),
  runningTimer: () =>
    api<{ running: RunningTimer | null }>("/timer", { auth: "access" }),

  /* entries ---------------------------------------------------------- */
  listEntries: (taskId: string) =>
    api<{ entries: TimeEntry[]; totalSeconds: number; billableSeconds: number }>(
      `/tasks/${taskId}/time-entries`,
      { auth: "access" },
    ),
  createEntry: (
    taskId: string,
    body: { startedAt: string; endedAt: string; billable?: boolean; note?: string },
  ) =>
    api<{ entry: TimeEntry }>(`/tasks/${taskId}/time-entries`, {
      method: "POST",
      body,
      auth: "access",
    }),
  updateEntry: (
    id: string,
    body: {
      startedAt?: string;
      endedAt?: string;
      billable?: boolean;
      note?: string | null;
    },
  ) =>
    api<{ entry: TimeEntry }>(`/time-entries/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  removeEntry: (id: string) =>
    api<void>(`/time-entries/${id}`, { method: "DELETE", auth: "access" }),

  /* timesheets ------------------------------------------------------- */
  myTimesheet: (weekStart: string) =>
    api<MyTimesheet>(`/timesheets/me?weekStart=${encodeURIComponent(weekStart)}`, {
      auth: "access",
    }),
  submitTimesheet: (weekStart: string) =>
    api<{ submission: TimesheetSubmission }>("/timesheets/submit", {
      method: "POST",
      body: { weekStart },
      auth: "access",
    }),
  /** Admin/owner — every member's week totals. */
  teamTimesheets: (weekStart: string) =>
    api<{ rows: TimesheetRow[] }>(
      `/timesheets?weekStart=${encodeURIComponent(weekStart)}`,
      { auth: "access" },
    ),
  decideTimesheet: (userId: string, weekStart: string, decision: "approved" | "rejected") =>
    api<{ submission: TimesheetSubmission }>(`/timesheets/${userId}/decide`, {
      method: "POST",
      body: { weekStart, decision },
      auth: "access",
    }),

  /* workload --------------------------------------------------------- */
  workload: (weekStart: string) =>
    api<WorkloadWeek>(`/workload?weekStart=${encodeURIComponent(weekStart)}`, {
      auth: "access",
    }),
};

/* ------------------------------------------------------------------ *
 * Module 9 — Goals, OKRs & Portfolios.
 * Progress values are 0..1 floats; numeric fields may arrive from the
 * API as strings (decimal columns) — always coerce with Number() at
 * the point of display/math.
 * ------------------------------------------------------------------ */

/** A folder grouping goals on the Goals home. */
export interface GoalFolder {
  id: string;
  name: string;
  color: string;
  position: number;
  goalCount: number;
}

/** A goal as listed on the Goals home (targets come with the detail). */
export interface GoalSummary {
  id: string;
  folderId: string | null;
  name: string;
  description: string | null;
  owner: TaskUser | null;
  dueDate: string | null;
  archived: boolean;
  /** 0..1 (may arrive as a string — Number() it). */
  progress: number;
  targetCount: number;
  createdAt: string;
}

export type TargetType = "number" | "currency" | "boolean" | "tasks";

/** A task linked to a "tasks" target. */
export interface TargetTask {
  id: string;
  name: string;
  listId: string;
  statusType: StatusType;
}

/** A key result on a goal. Value fields may arrive as strings. */
export interface Target {
  id: string;
  name: string;
  type: TargetType;
  startValue: number;
  targetValue: number;
  currentValue: number;
  currency: string | null;
  done: boolean;
  position: number;
  /** 0..1 (may arrive as a string — Number() it). */
  progress: number;
  tasks?: TargetTask[];
}

export interface GoalDetail extends GoalSummary {
  targets: Target[];
}

export interface Portfolio {
  id: string;
  name: string;
  color: string;
  itemCount: number;
}

/** One list rolled up inside a portfolio. */
export interface PortfolioItem {
  listId: string;
  listName: string;
  spaceId: string;
  spaceName: string;
  color: string | null;
  stats: { total: number; done: number; inProgress: number; overdue: number };
  /** 0..1 (may arrive as a string — Number() it). */
  progress: number;
}

export const goalsApi = {
  /* folders ---------------------------------------------------------- */
  listFolders: () =>
    api<{ folders: GoalFolder[] }>("/goal-folders", { auth: "access" }),
  createFolder: (body: { name: string; color?: string }) =>
    api<{ folder: GoalFolder }>("/goal-folders", {
      method: "POST",
      body,
      auth: "access",
    }),
  updateFolder: (id: string, body: { name?: string; color?: string }) =>
    api<{ folder: GoalFolder }>(`/goal-folders/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  removeFolder: (id: string) =>
    api<void>(`/goal-folders/${id}`, { method: "DELETE", auth: "access" }),

  /* goals ------------------------------------------------------------ */
  list: () => api<{ goals: GoalSummary[] }>("/goals", { auth: "access" }),
  create: (body: {
    name: string;
    description?: string;
    folderId?: string;
    ownerUserId?: string;
    dueDate?: string;
  }) => api<{ goal: GoalSummary }>("/goals", { method: "POST", body, auth: "access" }),
  get: (id: string) =>
    api<{ goal: GoalDetail }>(`/goals/${id}`, { auth: "access" }),
  update: (
    id: string,
    body: {
      name?: string;
      description?: string | null;
      folderId?: string | null;
      ownerUserId?: string | null;
      dueDate?: string | null;
      archived?: boolean;
    },
  ) =>
    api<{ goal: GoalDetail }>(`/goals/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/goals/${id}`, { method: "DELETE", auth: "access" }),

  /* targets (key results) -------------------------------------------- */
  createTarget: (
    goalId: string,
    body: {
      name: string;
      type: TargetType;
      startValue?: number;
      targetValue?: number;
      currency?: string;
      taskIds?: string[];
    },
  ) =>
    api<{ target: Target }>(`/goals/${goalId}/targets`, {
      method: "POST",
      body,
      auth: "access",
    }),
  updateTarget: (
    id: string,
    body: {
      name?: string;
      startValue?: number;
      targetValue?: number;
      currentValue?: number;
      currency?: string;
      done?: boolean;
      taskIds?: string[];
    },
  ) =>
    api<{ target: Target }>(`/targets/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  removeTarget: (id: string) =>
    api<void>(`/targets/${id}`, { method: "DELETE", auth: "access" }),
};

export const portfoliosApi = {
  list: () =>
    api<{ portfolios: Portfolio[] }>("/portfolios", { auth: "access" }),
  create: (body: { name: string; color?: string; listIds?: string[] }) =>
    api<{ portfolio: Portfolio }>("/portfolios", {
      method: "POST",
      body,
      auth: "access",
    }),
  get: (id: string) =>
    api<{ portfolio: Portfolio; items: PortfolioItem[] }>(`/portfolios/${id}`, {
      auth: "access",
    }),
  update: (
    id: string,
    body: { name?: string; color?: string; listIds?: string[] },
  ) =>
    api<{ portfolio: Portfolio }>(`/portfolios/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/portfolios/${id}`, { method: "DELETE", auth: "access" }),
};

/* ------------------------------------------------------------------ *
 * Module 11 — Forms & Automations.
 * ------------------------------------------------------------------ */

/** The seven input types a form field can be. */
export type FormFieldType =
  | "text"
  | "textarea"
  | "email"
  | "number"
  | "select"
  | "date"
  | "checkbox";

/** Human labels for the form field types (add-field menu, editors). */
export const FORM_FIELD_TYPE_LABEL: Record<FormFieldType, string> = {
  text: "Text",
  textarea: "Long text",
  email: "Email",
  number: "Number",
  select: "Select",
  date: "Date",
  checkbox: "Checkbox",
};

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  /** Select fields only — the choices. */
  options?: string[];
  /** At most one field: its value becomes the created task's title. */
  asTitle?: boolean;
  /** Conditional visibility (M21): shown only when field `fieldId`'s answer equals `equals`. */
  visibleIf?: { fieldId: string; equals: string };
}

/** A form as listed on the Forms home. */
export interface FormSummary {
  id: string;
  name: string;
  listId: string;
  listName: string;
  active: boolean;
  publicToken: string;
  fieldCount: number;
  updatedAt: string;
}

/** The full form (builder payload). */
export interface FormDetail {
  id: string;
  name: string;
  description: string | null;
  listId: string;
  listName: string;
  active: boolean;
  publicToken: string;
  fields: FormField[];
  updatedAt: string;
}

/** What the anonymous public endpoint exposes — nothing more. */
export interface PublicForm {
  name: string;
  description: string | null;
  fields: FormField[];
}

export const formsApi = {
  list: () => api<{ forms: FormSummary[] }>("/forms", { auth: "access" }),
  create: (body: {
    name: string;
    listId: string;
    description?: string;
    fields: FormField[];
  }) => api<{ form: FormDetail }>("/forms", { method: "POST", body, auth: "access" }),
  get: (id: string) => api<{ form: FormDetail }>(`/forms/${id}`, { auth: "access" }),
  update: (
    id: string,
    body: {
      name?: string;
      description?: string | null;
      fields?: FormField[];
      active?: boolean;
      listId?: string;
    },
  ) =>
    api<{ form: FormDetail }>(`/forms/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/forms/${id}`, { method: "DELETE", auth: "access" }),
  /** Mint a fresh public token — every previously shared link breaks. */
  rotateToken: (id: string) =>
    api<{ publicToken: string }>(`/forms/${id}/rotate-token`, {
      method: "POST",
      auth: "access",
    }),
};

/**
 * Anonymous fetch for the public form page (`/f?token=…`). Never attaches
 * an Authorization header, never touches stored tokens and never bounces
 * to /login — the page must work for visitors with no account at all.
 */
export async function publicApi<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
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

export const publicFormsApi = {
  get: (token: string) =>
    publicApi<{ form: PublicForm }>(`/public/forms/${encodeURIComponent(token)}`),
  submit: (token: string, values: Record<string, unknown>) =>
    publicApi<{ ok: true }>(`/public/forms/${encodeURIComponent(token)}/submit`, {
      method: "POST",
      body: { values },
    }),
};

/* ---- Public share links (M26) ------------------------------------- */

export type ShareEntityType =
  | "space"
  | "folder"
  | "list"
  | "task"
  | "doc"
  | "dashboard";
export type SharePermission = "view" | "comment";

export interface ShareSummary {
  id: string;
  entityType: ShareEntityType;
  entityId: string;
  token: string;
  permission: SharePermission;
  createdAt: string;
}

export interface SharedPage {
  id: string;
  title: string;
  content: string;
  parentPageId: string | null;
  position: number;
}

/** The read-only payload the public share page renders. */
export interface SharedView {
  entityType: ShareEntityType;
  permission: SharePermission;
  workspaceName: string;
  title: string;
  task?: TaskDetail;
  list?: { name: string; tasks: TaskCard[] };
  doc?: { name: string; pages: SharedPage[] };
  dashboard?: { name: string; cards: DashboardCard[] };
  overview?: {
    kind: "space" | "folder";
    name: string;
    folders: { id: string; name: string }[];
    lists: { id: string; name: string }[];
  };
}

export const sharesApi = {
  forEntity: (type: ShareEntityType, id: string) =>
    api<{ share: ShareSummary | null }>(
      `/shares?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`,
      { auth: "access" },
    ),
  create: (
    entityType: ShareEntityType,
    entityId: string,
    permission: SharePermission = "view",
  ) =>
    api<{ share: ShareSummary }>("/shares", {
      method: "POST",
      body: { entityType, entityId, permission },
      auth: "access",
    }),
  revoke: (id: string) =>
    api<void>(`/shares/${id}`, { method: "DELETE", auth: "access" }),
};

export const publicShareApi = {
  resolve: (token: string) =>
    publicApi<{ view: SharedView }>(
      `/public/share/${encodeURIComponent(token)}`,
    ),
};

/** Build the shareable public URL for a token (current origin + /s?t=). */
export function shareUrl(token: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/s?t=${token}`;
}

/* ---- automations -------------------------------------------------- */

export type AutomationTriggerType =
  | "task.created"
  | "status.changed"
  | "priority.changed"
  | "assignee.added"
  | "due.overdue";

export interface AutomationTrigger {
  type: AutomationTriggerType;
  /** status.changed only — narrow to a destination status. */
  toStatusId?: string;
  /** priority.changed only — narrow to a destination priority. */
  toPriority?: Priority;
}

export type AutomationAction =
  | { type: "set.status"; statusId: string }
  | { type: "set.priority"; priority: Priority }
  | { type: "add.assignee"; userId: string }
  | { type: "add.tag"; tagId: string }
  | { type: "post.comment"; body: string };

export interface Automation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
}

/** One execution of an automation against a task. */
export interface AutomationRun {
  id: string;
  taskId: string;
  taskName: string;
  ok: boolean;
  detail: string | null;
  createdAt: string;
}

export const automationsApi = {
  list: (spaceId: string) =>
    api<{ automations: Automation[] }>(`/spaces/${spaceId}/automations`, {
      auth: "access",
    }),
  create: (
    spaceId: string,
    body: {
      name: string;
      trigger: AutomationTrigger;
      actions: AutomationAction[];
      enabled?: boolean;
    },
  ) =>
    api<{ automation: Automation }>(`/spaces/${spaceId}/automations`, {
      method: "POST",
      body,
      auth: "access",
    }),
  update: (
    id: string,
    body: {
      name?: string;
      trigger?: AutomationTrigger;
      actions?: AutomationAction[];
      enabled?: boolean;
    },
  ) =>
    api<{ automation: Automation }>(`/automations/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/automations/${id}`, { method: "DELETE", auth: "access" }),
  runs: (id: string) =>
    api<{ runs: AutomationRun[] }>(`/automations/${id}/runs`, { auth: "access" }),
};

/* ------------------------------------------------------------------ *
 * Task types — per-space (Module 4). "Task" is the implicit default.
 * ------------------------------------------------------------------ */
export const taskTypesApi = {
  list: (spaceId: string) =>
    api<{ taskTypes: TaskType[] }>(`/spaces/${spaceId}/task-types`, {
      auth: "access",
    }),
  create: (
    spaceId: string,
    body: { name: string; icon?: string | null; isMilestone?: boolean },
  ) =>
    api<{ taskType: TaskType }>(`/spaces/${spaceId}/task-types`, {
      method: "POST",
      body,
      auth: "access",
    }),
  update: (
    id: string,
    body: { name?: string; icon?: string | null; isMilestone?: boolean },
  ) =>
    api<{ taskType: TaskType }>(`/task-types/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/task-types/${id}`, { method: "DELETE", auth: "access" }),
};

/* ------------------------------------------------------------------ *
 * Module 10 — Dashboards, reporting & sprints.
 * Numeric aggregates may arrive as strings (decimal columns) — always
 * coerce with Number() at the point of display/math.
 * ------------------------------------------------------------------ */

/** The ten card visualizations a dashboard can hold. */
export type DashboardCardKind =
  | "statusBreakdown"
  | "assigneeLoad"
  | "priorityBreakdown"
  | "timeTracked"
  | "goalProgress"
  | "sprintBurndown"
  | "recentActivity"
  | "completionTrend"
  | "overdueByAssignee"
  | "text";

export type DashboardCardWidth = "half" | "full";

/** Client-owned card scope/config blob (the API stores it opaquely). */
export interface DashboardCardConfig {
  spaceId?: string;
  listId?: string;
  goalId?: string;
  sprintId?: string;
  days?: number;
  weeks?: number;
  text?: string;
}

export interface DashboardSummary {
  id: string;
  name: string;
  cardCount: number;
  updatedAt: string;
}

export interface DashboardCard {
  id: string;
  kind: DashboardCardKind;
  title: string;
  config: DashboardCardConfig;
  position: number;
  width: DashboardCardWidth;
}

/* ---- per-kind data payloads (GET /cards/:id/data) ----------------- */

/** One slice of a status/priority breakdown. */
export interface CardSlice {
  label: string;
  color: string;
  count: number;
}

export interface BreakdownCardData {
  slices: CardSlice[];
}

export interface AssigneeLoadRow {
  user: TaskUser;
  open: number;
  done: number;
}

export interface AssigneeLoadCardData {
  rows: AssigneeLoadRow[];
}

export interface TimeTrackedCardData {
  days: { date: string; seconds: number }[];
  totalSeconds: number;
}

export interface CompletionTrendCardData {
  weeks: { week: string; completed: number; created: number }[];
  totalCompleted: number;
}

export interface OverdueByAssigneeRow {
  user: TaskUser;
  overdue: number;
}

export interface OverdueByAssigneeCardData {
  rows: OverdueByAssigneeRow[];
  unassigned: number;
}

export interface GoalProgressCardData {
  /** progress is 0..1 (may arrive as a string — Number() it). */
  goals: { id: string; name: string; progress: number }[];
}

/** One point of a burndown series (remaining null = day not reached). */
export interface BurndownDay {
  date: string;
  remainingPoints: number | null;
  idealRemaining: number;
}

export interface SprintBurndownCardData {
  sprint: { id: string; name: string; startDate: string; endDate: string };
  totalPoints: number;
  days: BurndownDay[];
}

export interface RecentActivityItem {
  taskId: string;
  taskName: string;
  kind: string;
  /** The API may denormalize the actor as a user object or a plain name. */
  actor: TaskUser | string | null;
  createdAt: string;
}

export interface RecentActivityCardData {
  items: RecentActivityItem[];
}

export interface TextCardData {
  text: string;
}

/** Whatever `/cards/:id/data` returns — narrow by the card's kind. */
export type DashboardCardData =
  | BreakdownCardData
  | AssigneeLoadCardData
  | TimeTrackedCardData
  | GoalProgressCardData
  | SprintBurndownCardData
  | RecentActivityCardData
  | CompletionTrendCardData
  | OverdueByAssigneeCardData
  | TextCardData;

export const dashboardsApi = {
  list: () =>
    api<{ dashboards: DashboardSummary[] }>("/dashboards", { auth: "access" }),
  create: (body: { name: string }) =>
    api<{ dashboard: DashboardSummary }>("/dashboards", {
      method: "POST",
      body,
      auth: "access",
    }),
  get: (id: string) =>
    api<{ dashboard: DashboardSummary; cards: DashboardCard[] }>(
      `/dashboards/${id}`,
      { auth: "access" },
    ),
  update: (id: string, body: { name?: string }) =>
    api<{ dashboard: DashboardSummary }>(`/dashboards/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/dashboards/${id}`, { method: "DELETE", auth: "access" }),

  /* cards ------------------------------------------------------------ */
  createCard: (
    dashboardId: string,
    body: {
      kind: DashboardCardKind;
      title?: string;
      config?: DashboardCardConfig;
      width?: DashboardCardWidth;
    },
  ) =>
    api<{ card: DashboardCard }>(`/dashboards/${dashboardId}/cards`, {
      method: "POST",
      body,
      auth: "access",
    }),
  updateCard: (
    cardId: string,
    body: {
      title?: string;
      config?: DashboardCardConfig;
      width?: DashboardCardWidth;
      position?: number;
    },
  ) =>
    api<{ card: DashboardCard }>(`/cards/${cardId}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  removeCard: (cardId: string) =>
    api<void>(`/cards/${cardId}`, { method: "DELETE", auth: "access" }),
  /** The card's visualization payload — shape depends on its kind. */
  cardData: (cardId: string) =>
    api<{ data: DashboardCardData }>(`/cards/${cardId}/data`, {
      auth: "access",
    }).then((r) => r.data),
};

/* ---- sprints ------------------------------------------------------ */

/** A sprint IS a list (listId) with dates and a points rollup. */
export interface Sprint {
  id: string;
  listId: string;
  name: string;
  startDate: string;
  endDate: string;
  archived: boolean;
  totalPoints: number;
  completedPoints: number;
}

export interface SprintVelocityEntry {
  sprintId: string;
  name: string;
  completedPoints: number;
}

export interface SprintReport {
  sprint: Sprint;
  totalPoints: number;
  completedPoints: number;
  velocity: SprintVelocityEntry[];
  burndown: { days: BurndownDay[] };
}

export const sprintsApi = {
  list: (spaceId: string) =>
    api<{ sprints: Sprint[] }>(`/spaces/${spaceId}/sprints`, {
      auth: "access",
    }),
  create: (
    spaceId: string,
    body: { name?: string; startDate: string; endDate: string },
  ) =>
    api<{ sprint: Sprint }>(`/spaces/${spaceId}/sprints`, {
      method: "POST",
      body,
      auth: "access",
    }),
  update: (
    id: string,
    body: {
      name?: string;
      startDate?: string;
      endDate?: string;
      archived?: boolean;
    },
  ) =>
    api<{ sprint: Sprint }>(`/sprints/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/sprints/${id}`, { method: "DELETE", auth: "access" }),
  report: (id: string) =>
    api<SprintReport>(`/sprints/${id}/report`, { auth: "access" }),
};

/* ================================================================== *
 * Module 12 — Visual collaboration: Whiteboards & Mind maps.
 *
 * Both store a client-owned JSON blob (elements array / root tree) the
 * API persists opaquely — the canvas is entirely frontend-driven.
 * ================================================================== */

/** The five element kinds a whiteboard canvas can hold. */
export type WhiteboardElementKind =
  | "sticky"
  | "rect"
  | "ellipse"
  | "text"
  | "arrow";

/**
 * One canvas element. Coordinates are world-space (pre-zoom). Arrows
 * carry their two endpoints in `points`; x/y/w/h stay the bounding box.
 * The whole array is client-owned and PATCHed wholesale (≤512KB).
 */
export interface WhiteboardElement {
  id: string;
  kind: WhiteboardElementKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  color?: string;
  points?: { x: number; y: number }[];
  fontSize?: number;
}

/** Optional cross-reference links a board can carry (M31). */
export interface WhiteboardLinks {
  folderId: string | null;
  folderName: string | null;
  listId: string | null;
  listName: string | null;
  taskId: string | null;
  taskName: string | null;
}

/** A whiteboard as listed on the visual hub. */
export interface WhiteboardSummary extends WhiteboardLinks {
  id: string;
  name: string;
  /** Space the board is attached to; null = workspace-level. */
  spaceId: string | null;
  spaceName: string | null;
  updatedAt: string;
  updatedBy: string | null;
  elementCount: number;
}

/** The full board including its element array. */
export interface WhiteboardDetail extends WhiteboardLinks {
  id: string;
  name: string;
  spaceId: string | null;
  elements: WhiteboardElement[];
  updatedAt: string;
}

/** Fields accepted when creating a board (name + optional placement/links/seed). */
export interface WhiteboardCreate {
  name: string;
  spaceId?: string | null;
  elements?: WhiteboardElement[];
  folderId?: string | null;
  listId?: string | null;
  taskId?: string | null;
}

export const whiteboardsApi = {
  list: () =>
    api<{ whiteboards: WhiteboardSummary[] }>("/whiteboards", {
      auth: "access",
    }),
  create: (body: WhiteboardCreate) =>
    api<{ whiteboard: WhiteboardDetail }>("/whiteboards", {
      method: "POST",
      body,
      auth: "access",
    }),
  get: (id: string) =>
    api<{ whiteboard: WhiteboardDetail }>(`/whiteboards/${id}`, {
      auth: "access",
    }),
  update: (
    id: string,
    body: {
      name?: string;
      elements?: WhiteboardElement[];
      spaceId?: string | null;
      folderId?: string | null;
      listId?: string | null;
      taskId?: string | null;
    },
  ) =>
    api<{ whiteboard: WhiteboardDetail }>(`/whiteboards/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/whiteboards/${id}`, { method: "DELETE", auth: "access" }),
};

/**
 * A mind-map node. The whole tree hangs off the map's `root` and is
 * client-owned jsonb — `collapsed` and `taskId` (set when a node is
 * converted to a task) ride along in the same blob.
 */
export interface MindmapNode {
  id: string;
  text: string;
  children: MindmapNode[];
  collapsed?: boolean;
  taskId?: string;
}

/** A mind map as listed on the visual hub. */
export interface MindmapSummary {
  id: string;
  name: string;
  spaceId: string | null;
  spaceName: string | null;
  updatedAt: string;
  updatedBy: string | null;
  /** Node count-ish rollup (the server may omit it — guard at display). */
  nodeCount?: number;
}

/** The full map including its root tree. */
export interface MindmapDetail {
  id: string;
  name: string;
  spaceId: string | null;
  root: MindmapNode;
  updatedAt: string;
}

export const mindmapsApi = {
  list: () =>
    api<{ mindmaps: MindmapSummary[] }>("/mindmaps", { auth: "access" }),
  create: (body: { name: string; spaceId?: string | null }) =>
    api<{ mindmap: MindmapSummary }>("/mindmaps", {
      method: "POST",
      body,
      auth: "access",
    }),
  get: (id: string) =>
    api<{ mindmap: MindmapDetail }>(`/mindmaps/${id}`, { auth: "access" }),
  update: (
    id: string,
    body: { name?: string; root?: MindmapNode; spaceId?: string | null },
  ) =>
    api<{ mindmap: MindmapDetail }>(`/mindmaps/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/mindmaps/${id}`, { method: "DELETE", auth: "access" }),
};

/* ==========================================================================
   Module 12: Attachments & Proofing (files live under whiteboards/mindmaps
   API section above; these are task-scoped).
   ========================================================================== */

export interface TaskFile {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  isClip: boolean;
  author: PublicUser;
  createdAt: string;
  annotationCount: number;
}

export interface ProofAnnotation {
  id: string;
  x: number;
  y: number;
  body: string;
  author: PublicUser;
  resolvedAt: string | null;
  createdAt: string;
}

export const filesApi = {
  list: (taskId: string) =>
    api<{ files: TaskFile[] }>(`/tasks/${taskId}/files`, {
      auth: "access",
    }).then((r) => r.files),
  upload: (
    taskId: string,
    body: { name: string; mime: string; dataBase64: string; isClip?: boolean },
  ) =>
    api<{ file: TaskFile }>(`/tasks/${taskId}/files`, {
      method: "POST",
      body,
      auth: "access",
    }).then((r) => r.file),
  remove: (id: string) =>
    api<void>(`/files/${id}`, { method: "DELETE", auth: "access" }),
  /** The raw file URL (needs the auth header, so use blobUrl() for <img>). */
  rawUrl: (id: string) => `${API_BASE}/files/${id}`,
  /** Fetch a file WITH auth and return an object URL for <img>/<video>. */
  blobUrl: async (id: string): Promise<string> => {
    const res = await fetch(`${API_BASE}/files/${id}`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
    });
    if (!res.ok) throw new Error(`file ${id}: ${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
};

export const annotationsApi = {
  list: (fileId: string) =>
    api<{ annotations: ProofAnnotation[] }>(`/files/${fileId}/annotations`, {
      auth: "access",
    }).then((r) => r.annotations),
  add: (fileId: string, body: { x: number; y: number; body: string }) =>
    api<{ annotation: ProofAnnotation }>(`/files/${fileId}/annotations`, {
      method: "POST",
      body,
      auth: "access",
    }).then((r) => r.annotation),
  update: (id: string, body: { body?: string; resolved?: boolean }) =>
    api<{ annotation: ProofAnnotation }>(`/annotations/${id}`, {
      method: "PATCH",
      body,
      auth: "access",
    }).then((r) => r.annotation),
  remove: (id: string) =>
    api<void>(`/annotations/${id}`, { method: "DELETE", auth: "access" }),
};

/* ================================================================== *
 * Module 13 — Chat (channels, DMs, messages, threads, reactions,
 * SyncUp) + task Email log. Slack-like messaging, workspace-scoped.
 *
 * Mentions travel as `@[userId]` tokens in a message body and are
 * resolved to @Name chips against the workspace member list (see
 * `renderMentions` in CommentsActivity).
 * ================================================================== */

/** A person as embedded in chat payloads (author, member, SyncUp starter). */
export interface ChatUser {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

/** A channel row in the left rail (from GET /channels). */
export interface Channel {
  id: string;
  name: string;
  /** True for a 1:1 direct message; the "name" is the other person's name. */
  isDm: boolean;
  members: ChatUser[];
  memberCount: number;
  /** Unread message count for the current user. */
  unread: number;
  /** ISO timestamp of the most recent message, or null when empty. */
  lastMessageAt: string | null;
}

/** A public channel as listed in the Browse modal (GET /channels/public). */
export interface PublicChannel {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  /** Whether the current user has already joined. */
  joined: boolean;
}

/** One reaction bucket on a message. */
export interface Reaction {
  emoji: string;
  count: number;
  /** Whether the current user is part of this reaction. */
  mine: boolean;
}

/** A chat message (channel message or thread reply). */
export interface ChatMessage {
  id: string;
  /** Set when this message is a threaded reply. */
  parentMessageId: string | null;
  author: ChatUser;
  body: string;
  /** ISO timestamp of the last edit, or null when never edited. */
  editedAt: string | null;
  createdAt: string;
  reactions: Reaction[];
  /** Number of threaded replies (only meaningful on a parent message). */
  replyCount: number;
}

/** An active SyncUp (lightweight "we're talking now" presence). */
export interface Syncup {
  id: string;
  startedBy: ChatUser;
  startedAt: string;
}

export const chatApi = {
  /** Channels + DMs the current user belongs to (newest activity first). */
  list: () => api<{ channels: Channel[] }>("/channels", { auth: "access" }),

  /** Public channels available to browse & join. */
  listPublic: () =>
    api<{ channels: PublicChannel[] }>("/channels/public", { auth: "access" }),

  /** Create a new (public) channel. */
  create: (body: { name: string; description?: string }) =>
    api<{ channel: Channel }>("/channels", {
      method: "POST",
      body,
      auth: "access",
    }),

  join: (id: string) =>
    api<{ channel?: Channel }>(`/channels/${id}/join`, {
      method: "POST",
      auth: "access",
    }),

  leave: (id: string) =>
    api<unknown>(`/channels/${id}/leave`, { method: "POST", auth: "access" }),

  /** Mark a channel read up to now (clears its unread badge). */
  markRead: (id: string) =>
    api<unknown>(`/channels/${id}/read`, { method: "POST", auth: "access" }),

  /** Find-or-create the DM channel with another workspace member. */
  openDm: (userId: string) =>
    api<{ channel: Channel }>("/dms", {
      method: "POST",
      body: { userId },
      auth: "access",
    }),

  /**
   * A page of messages, newest-first. Pass `before` (an ISO timestamp) to
   * page backwards through history for infinite scroll-up.
   */
  messages: (id: string, opts: { before?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.before) q.set("before", opts.before);
    q.set("limit", String(opts.limit ?? 50));
    return api<{ messages: ChatMessage[] }>(
      `/channels/${id}/messages?${q.toString()}`,
      { auth: "access" },
    );
  },

  /** A thread: its parent message plus all replies (oldest-first). */
  thread: (messageId: string) =>
    api<{ parent: ChatMessage; replies: ChatMessage[] }>(
      `/messages/${messageId}/thread`,
      { auth: "access" },
    ),

  /** Post a message (top-level, or a reply when parentMessageId is set). */
  send: (id: string, body: { body: string; parentMessageId?: string }) =>
    api<{ message: ChatMessage }>(`/channels/${id}/messages`, {
      method: "POST",
      body,
      auth: "access",
    }),

  edit: (messageId: string, body: { body: string }) =>
    api<{ message: ChatMessage }>(`/messages/${messageId}`, {
      method: "PATCH",
      body,
      auth: "access",
    }),

  remove: (messageId: string) =>
    api<void>(`/messages/${messageId}`, { method: "DELETE", auth: "access" }),

  /** Toggle a reaction on a message; returns the updated reaction buckets. */
  react: (messageId: string, emoji: string) =>
    api<{ reactions: Reaction[] }>(`/messages/${messageId}/reactions`, {
      method: "POST",
      body: { emoji },
      auth: "access",
    }),

  /** The active SyncUp for a channel, if any. */
  getSyncup: (id: string) =>
    api<{ active: Syncup | null }>(`/channels/${id}/syncup`, { auth: "access" }),

  /** Start a SyncUp in a channel. */
  startSyncup: (id: string) =>
    api<{ syncup: Syncup }>(`/channels/${id}/syncup/start`, {
      method: "POST",
      auth: "access",
    }),

  /** End a SyncUp. */
  endSyncup: (syncupId: string) =>
    api<{ ok: boolean }>(`/syncups/${syncupId}/end`, {
      method: "POST",
      auth: "access",
    }),
};

/* ------------------------------------------------------------------ *
 * Task email — a per-task email log sent via the workspace's
 * configured mail adapter (mounted in the Task panel).
 * ------------------------------------------------------------------ */
export interface TaskEmailRecord {
  id: string;
  /** "outbound" (we sent it) or "inbound" (a reply arrived). */
  direction: "outbound" | "inbound";
  fromAddr: string;
  toAddr: string;
  subject: string;
  body: string;
  createdAt: string;
}

export const emailApi = {
  list: (taskId: string) =>
    api<{ emails: TaskEmailRecord[] }>(`/tasks/${taskId}/emails`, {
      auth: "access",
    }),
  send: (taskId: string, body: { to: string; subject: string; body: string }) =>
    api<{ email: TaskEmailRecord }>(`/tasks/${taskId}/emails`, {
      method: "POST",
      body,
      auth: "access",
    }),
};

/* ================================================================== *
 * Module 14 — Universal Search, Home / My Work, Template Center,
 * ClickApps & Favorites. Workspace-scoped (access token).
 * ================================================================== */

/* ---- Universal search (Command Center) ---------------------------- */

/** A task hit — `subtitle` is a denormalized breadcrumb ("Space · List"). */
export interface SearchTaskHit {
  id: string;
  title: string;
  subtitle: string | null;
  listId: string;
  spaceId: string | null;
}
export interface SearchListHit {
  id: string;
  name: string;
  spaceId: string | null;
  spaceName: string | null;
}
export interface SearchSpaceHit {
  id: string;
  name: string;
  icon: string | null;
}
export interface SearchNamedHit {
  id: string;
  name: string;
  icon?: string | null;
}

/** The grouped payload of `GET /search`. Any group may be empty. */
export interface SearchResults {
  tasks: SearchTaskHit[];
  lists: SearchListHit[];
  spaces: SearchSpaceHit[];
  docs: SearchNamedHit[];
  goals: SearchNamedHit[];
  whiteboards: SearchNamedHit[];
  channels: SearchNamedHit[];
}

const EMPTY_SEARCH: SearchResults = {
  tasks: [],
  lists: [],
  spaces: [],
  docs: [],
  goals: [],
  whiteboards: [],
  channels: [],
};

export const searchApi = {
  /** Live universal search. Tolerant of partial payloads (missing groups). */
  search: (q: string, limit = 8) =>
    api<{ results: Partial<SearchResults> }>(
      `/search?q=${encodeURIComponent(q)}&limit=${limit}`,
      { auth: "access" },
    ).then((r) => ({ ...EMPTY_SEARCH, ...(r.results ?? {}) })),
};

/* ---- Home / My Work ----------------------------------------------- */

/** A "recently touched" entry on the Home feed. */
export interface HomeRecent {
  taskId: string;
  taskName: string;
  listId: string;
  kind: string;
  createdAt: string;
}

/** A reminder as surfaced on Home (a superset shape of Reminder). */
export interface HomeReminder {
  id: string;
  note: string;
  remindAt: string;
  taskId: string | null;
  taskName: string | null;
}

/** The `GET /home` payload — the personal "My Work" dashboard. */
export interface HomeData {
  assignedOpen: number;
  overdue: TaskCard[];
  dueToday: TaskCard[];
  upcoming: TaskCard[];
  unscheduled: TaskCard[];
  reminders: HomeReminder[];
  recent: HomeRecent[];
}

/** At-a-glance workspace counts for the Home stat tiles. */
export interface HomeOverview {
  spaces: number;
  tasks: number;
  docs: number;
  goals: number;
  dashboards: number;
  members: number;
}

export const homeApi = {
  get: () => api<HomeData>("/home", { auth: "access" }),
  overview: () => api<HomeOverview>("/home/overview", { auth: "access" }),
};

/* ---- Template Center ---------------------------------------------- */

/** The four things that can be saved as (and applied from) a template. */
export type TemplateKind = "task" | "list" | "doc" | "space";

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  task: "Task",
  list: "List",
  doc: "Doc",
  space: "Space",
};

export interface Template {
  id: string;
  kind: TemplateKind;
  name: string;
  description: string | null;
  icon: string | null;
  createdAt: string;
}

export const templatesApi = {
  list: (kind?: TemplateKind) =>
    api<{ templates: Template[] }>(
      `/templates${kind ? `?kind=${kind}` : ""}`,
      { auth: "access" },
    ),
  /** Snapshot an existing entity (task/list/doc/space) as a new template. */
  createFrom: (
    kind: TemplateKind,
    id: string,
    body: { name: string; description?: string; icon?: string | null },
  ) =>
    api<{ template: Template }>(`/templates/from/${kind}/${id}`, {
      method: "POST",
      body,
      auth: "access",
    }),
  /** Instantiate a template into the chosen target; returns the new entity id. */
  apply: (
    id: string,
    body: { targetListId?: string; targetSpaceId?: string; name?: string },
  ) =>
    api<{ createdId: string; kind: TemplateKind }>(`/templates/${id}/apply`, {
      method: "POST",
      body,
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/templates/${id}`, { method: "DELETE", auth: "access" }),
};

/* ---- ClickApps (per-space feature toggles) ------------------------ */

export interface SpaceClickApps {
  timeTracking: boolean;
  sprints: boolean;
  customFields: boolean;
  priorities: boolean;
  tags: boolean;
  dependencies: boolean;
  milestones: boolean;
  points: boolean;
}

/** Display metadata for the eight ClickApp toggles (label + blurb). */
export const CLICKAPP_META: {
  key: keyof SpaceClickApps;
  label: string;
  desc: string;
}[] = [
  { key: "timeTracking", label: "Time tracking", desc: "Timers & timesheets on tasks." },
  { key: "sprints", label: "Sprints", desc: "Time-boxed sprint lists & burndown." },
  { key: "customFields", label: "Custom fields", desc: "Add typed fields to tasks." },
  { key: "priorities", label: "Priorities", desc: "Urgent → Low priority flags." },
  { key: "tags", label: "Tags", desc: "Colored labels across tasks." },
  { key: "dependencies", label: "Dependencies", desc: "Blocking & waiting-on links." },
  { key: "milestones", label: "Milestones", desc: "Mark tasks as milestones." },
  { key: "points", label: "Points", desc: "Sprint / story point estimates." },
];

export const clickappsApi = {
  get: (spaceId: string) =>
    api<{ clickapps: SpaceClickApps }>(`/spaces/${spaceId}/clickapps`, {
      auth: "access",
    }),
  update: (spaceId: string, clickapps: SpaceClickApps) =>
    api<{ clickapps: SpaceClickApps }>(`/spaces/${spaceId}/clickapps`, {
      method: "PUT",
      body: { clickapps },
      auth: "access",
    }),
};

/* ---- Favorites ---------------------------------------------------- */

export type FavoriteType = "space" | "list" | "doc";

export interface Favorite {
  entityType: FavoriteType;
  entityId: string;
  name: string;
}

export const favoritesApi = {
  list: () => api<{ favorites: Favorite[] }>("/favorites", { auth: "access" }),
  add: (entityType: FavoriteType, entityId: string) =>
    api<{ favorite?: Favorite }>("/favorites", {
      method: "POST",
      body: { entityType, entityId },
      auth: "access",
    }),
  remove: (entityType: FavoriteType, entityId: string) =>
    api<void>(`/favorites/${entityType}/${entityId}`, {
      method: "DELETE",
      auth: "access",
    }),
};

/* ---- Module 15: AI Brain ------------------------------------------ */

export type AiSource = "claude" | "heuristic";
export type AiWriteAction = "improve" | "expand" | "shorten" | "fix" | "draft";

export interface AiCommand {
  intent: "create_task" | "search" | "unknown";
  taskName?: string;
  listHint?: string;
  query?: string;
  raw: string;
}

export const aiApi = {
  status: () =>
    api<{ available: boolean; model: string }>("/ai/status", {
      auth: "access",
    }),
  write: (action: AiWriteAction, text: string, tone?: string) =>
    api<{ text: string; source: AiSource }>("/ai/write", {
      method: "POST",
      body: { action, text, tone },
      auth: "access",
    }),
  summarize: (text: string) =>
    api<{ text: string; source: AiSource }>("/ai/summarize", {
      method: "POST",
      body: { text },
      auth: "access",
    }),
  taskSummary: (taskId: string) =>
    api<{ text: string; source: AiSource }>(`/ai/tasks/${taskId}/summary`, {
      method: "POST",
      auth: "access",
    }),
  taskSubtasks: (taskId: string) =>
    api<{ items: string[]; source: AiSource }>(`/ai/tasks/${taskId}/subtasks`, {
      method: "POST",
      auth: "access",
    }),
  subtasks: (prompt: string) =>
    api<{ items: string[]; source: AiSource }>("/ai/subtasks", {
      method: "POST",
      body: { prompt },
      auth: "access",
    }),
  command: (text: string) =>
    api<{ command: AiCommand }>("/ai/command", {
      method: "POST",
      body: { text },
      auth: "access",
    }),
  /** AI Builder: brief → preview plan (no writes). */
  buildPlan: (prompt: string) =>
    api<{ plan: AiBuildPlan; source: AiSource }>("/ai/build/plan", {
      method: "POST",
      body: { prompt },
      auth: "access",
    }),
  /** AI Builder: execute a (previewed) plan → created spaces/lists/tasks/docs. */
  build: (plan: AiBuildPlan) =>
    api<AiBuildResult>("/ai/build", {
      method: "POST",
      body: { plan },
      auth: "access",
    }),
};

/* ---- AI Builder types --------------------------------------------- */

export interface AiPlanTask {
  name: string;
  description?: string;
  priority?: "urgent" | "high" | "normal" | "low";
  dueInDays?: number;
}
export interface AiPlanList {
  name: string;
  tasks: AiPlanTask[];
}
export interface AiPlanDoc {
  name: string;
  icon?: string;
  content?: string;
}
export interface AiPlanSpace {
  name: string;
  icon?: string;
  lists: AiPlanList[];
  docs?: AiPlanDoc[];
}
export interface AiBuildPlan {
  summary: string;
  spaces: AiPlanSpace[];
}
export interface AiBuildResult {
  summary: string;
  spaces: { id: string; name: string; url: string }[];
  lists: { id: string; name: string; url: string }[];
  tasks: { id: string; name: string; listId: string }[];
  docs: { id: string; name: string; url: string }[];
  counts: { spaces: number; lists: number; tasks: number; docs: number };
}

/* ---- Module 15: Personal Access Tokens & public API --------------- */

export type PatScope = "read" | "write";

export interface PatSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: PatScope;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export const apiTokensApi = {
  list: () => api<{ tokens: PatSummary[] }>("/pat", { auth: "access" }),
  create: (name: string, scope: PatScope) =>
    api<{ token: string; pat: PatSummary }>("/pat", {
      method: "POST",
      body: { name, scope },
      auth: "access",
    }),
  revoke: (id: string) =>
    api<void>(`/pat/${id}`, { method: "DELETE", auth: "access" }),
};

/* ---- Module 15: Webhooks ------------------------------------------ */

export interface WebhookSummary {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  statusCode: number | null;
  ok: boolean;
  error: string | null;
  createdAt: string;
}

export const webhooksApi = {
  list: () =>
    api<{ webhooks: WebhookSummary[] }>("/webhooks", { auth: "access" }),
  create: (url: string, events: string[]) =>
    api<{ webhook: WebhookSummary; secret: string }>("/webhooks", {
      method: "POST",
      body: { url, events },
      auth: "access",
    }),
  deliveries: (id: string) =>
    api<{ deliveries: WebhookDelivery[] }>(`/webhooks/${id}/deliveries`, {
      auth: "access",
    }),
  test: (id: string) =>
    api<{ ok: boolean; statusCode: number | null }>(`/webhooks/${id}/test`, {
      method: "POST",
      auth: "access",
    }),
  remove: (id: string) =>
    api<void>(`/webhooks/${id}`, { method: "DELETE", auth: "access" }),
};

/* ---- Module 15: Import / Export ----------------------------------- */

export interface ImportResult {
  spaceId: string;
  lists: number;
  tasks: number;
}

export const importExportApi = {
  exportWorkspace: () =>
    api<{ spaces: unknown[] }>("/export/workspace", { auth: "access" }),
  importCsv: (listId: string, csv: string) =>
    api<{ tasks: number }>("/import/csv", {
      method: "POST",
      body: { listId, csv },
      auth: "access",
    }),
  importBoard: (source: string, data: unknown) =>
    api<ImportResult>("/import/board", {
      method: "POST",
      body: { source, data },
      auth: "access",
    }),
  /** Download a list's tasks as a CSV file (auth-fetch → blob → click). */
  downloadListCsv: async (listId: string, filename = "tasks.csv") => {
    const token = getAccessToken();
    const res = await fetch(`${API_BASE}/lists/${listId}/export.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const blob = await res.blob();
    if (typeof window === "undefined") return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
