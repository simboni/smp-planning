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
