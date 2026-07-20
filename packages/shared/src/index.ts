/** Types shared between the StackUp API and web/mobile clients. */

/** Workspace membership roles, most to least privileged. */
export const ROLES = ["owner", "admin", "member", "guest"] as const;
export type Role = (typeof ROLES)[number];

/** Claims carried by the workspace-scoped access token. */
export interface WorkspaceTokenClaims {
  /** user id */
  sub: string;
  /** workspace id */
  wsp: string;
  /** role in that workspace */
  rol: Role;
  /** token type discriminator */
  typ: "access";
}

/** Claims carried by the pre-workspace (identity-only) token. */
export interface IdentityTokenClaims {
  sub: string;
  typ: "identity";
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  color: string;
  avatarUrl: string | null;
  role: Role;
}

/** Role precedence helper: does `role` meet or exceed `required`? */
export function roleAtLeast(role: Role, required: Role): boolean {
  return ROLES.indexOf(role) <= ROLES.indexOf(required);
}

// ---------------------------------------------------------------------------
// Governance (Module 17): custom roles & capabilities.
//
// The four built-in roles (owner/admin/member/guest) remain the hard,
// RLS-relevant identity. Custom roles are an ADDITIVE capability layer an
// admin can define and assign to a member/guest: they derive from a base
// built-in role and override individual capability flags. owner/admin always
// hold every capability regardless of any assignment.
// ---------------------------------------------------------------------------

/** Fine-grained, workspace-level capabilities a custom role can toggle. */
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

/** A full capability set (every key present). */
export type CapabilitySet = Record<Capability, boolean>;

/** A partial override map, as stored on a custom role. */
export type CapabilityOverrides = Partial<CapabilitySet>;

/** Human labels for the capability toggles (UI). */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  createSpaces: "Create Spaces",
  deleteItems: "Delete items (Spaces, Folders, Lists, Tasks)",
  createDocs: "Create Docs",
  manageAutomations: "Create & manage Automations",
  exportData: "Export workspace data",
  viewAuditLog: "View the audit log",
  manageMembers: "Invite & manage members",
};

/** Baseline capabilities granted by each built-in role. */
export const ROLE_CAPABILITIES: Record<Role, CapabilitySet> = {
  owner: {
    createSpaces: true,
    deleteItems: true,
    createDocs: true,
    manageAutomations: true,
    exportData: true,
    viewAuditLog: true,
    manageMembers: true,
  },
  admin: {
    createSpaces: true,
    deleteItems: true,
    createDocs: true,
    manageAutomations: true,
    exportData: true,
    viewAuditLog: true,
    manageMembers: true,
  },
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

/**
 * Resolve an effective capability set from a built-in role and an optional
 * custom role (its base role + overrides). owner/admin always get everything;
 * a custom role starts from ITS base role's baseline, then applies overrides.
 */
export function resolveCapabilities(
  role: Role,
  custom?: { baseRole: Role; capabilities: CapabilityOverrides } | null,
): CapabilitySet {
  if (role === "owner" || role === "admin") {
    return { ...ROLE_CAPABILITIES[role] };
  }
  const base = custom ? ROLE_CAPABILITIES[custom.baseRole] : ROLE_CAPABILITIES[role];
  const eff: CapabilitySet = { ...base };
  if (custom) {
    for (const cap of CAPABILITIES) {
      const v = custom.capabilities[cap];
      if (typeof v === "boolean") eff[cap] = v;
    }
  }
  return eff;
}

/** A custom role as returned to clients. */
export interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  baseRole: Role;
  capabilities: CapabilityOverrides;
  memberCount: number;
  createdAt: string;
}

/** One entry in the workspace audit log (read side). */
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

/** Result of re-walking the audit hash chain to check for tampering. */
export interface AuditIntegrity {
  ok: boolean;
  checked: number;
  /** id of the first row whose hash doesn't match, when ok = false. */
  brokenAt: string | null;
}
