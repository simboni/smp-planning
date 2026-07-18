import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import type {
  IdentityTokenClaims,
  PublicUser,
  Role,
  WorkspaceSummary,
  WorkspaceTokenClaims,
} from "@stackup/shared";
import { loadConfig } from "../config";
import { DbService } from "../db/db.service";

export interface SignupInput {
  email: string;
  fullName: string;
  password: string;
}

export interface AuthResult {
  identityToken: string;
  refreshToken: string;
  user: PublicUser;
  workspaces: WorkspaceSummary[];
}

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  password_hash: string;
  status: string;
}

/**
 * A fixed argon2id hash of a random string. login() verifies against it
 * when the email is unknown so a missing account and a wrong password take
 * the same amount of work — no user-enumeration timing side channel.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

@Injectable()
export class AuthService {
  private readonly config = loadConfig();

  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Register a new identity. A brand-new user belongs to no workspace yet,
   * so we return an empty workspaces list; they create or are invited to one
   * next. 409 on a duplicate email (case-insensitive, enforced by the
   * users_email_key unique index on lower(email)).
   */
  async signup(input: SignupInput): Promise<AuthResult> {
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    let user: UserRow;
    try {
      const res = await this.db.query(
        `INSERT INTO users (email, password_hash, full_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, full_name, avatar_url, password_hash, status`,
        [input.email.trim(), passwordHash, input.fullName.trim()],
      );
      user = res.rows[0] as UserRow;
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "23505") {
        throw new ConflictException("Email already in use");
      }
      throw err;
    }
    return {
      identityToken: await this.issueIdentityToken(user.id),
      refreshToken: await this.issueRefreshToken(user.id),
      user: toPublicUser(user),
      workspaces: [],
    };
  }

  /**
   * Authenticate by email + password and load the caller's workspaces so a
   * client can render the picker immediately. 401 (generic) on any failure —
   * unknown email, wrong password, or a non-active account — to avoid
   * leaking which emails exist.
   */
  async login(email: string, password: string): Promise<AuthResult> {
    const res = await this.db.query(
      `SELECT id, email, full_name, avatar_url, password_hash, status
       FROM users WHERE lower(email) = lower($1)`,
      [email.trim()],
    );
    const user = res.rows[0] as UserRow | undefined;
    const valid = await argon2
      .verify(user?.password_hash ?? DUMMY_HASH, password)
      .catch(() => false);
    if (!user || !valid || user.status !== "active") {
      throw new UnauthorizedException("Invalid credentials");
    }
    return {
      identityToken: await this.issueIdentityToken(user.id),
      refreshToken: await this.issueRefreshToken(user.id),
      user: toPublicUser(user),
      workspaces: await this.listWorkspaces(user.id),
    };
  }

  /**
   * Rotate a refresh token: verify it is known, unrevoked and unexpired,
   * revoke it, issue a fresh refresh token and a new identity token. Single
   * use — the old token is dead the moment it is redeemed. 401 if invalid.
   */
  async refresh(
    refreshToken: string,
  ): Promise<{ identityToken: string; refreshToken: string }> {
    const tokenHash = sha256(refreshToken);
    const res = await this.db.query(
      `SELECT id, user_id, expires_at, revoked_at
       FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = res.rows[0] as
      | {
          id: string;
          user_id: string;
          expires_at: string;
          revoked_at: string | null;
        }
      | undefined;
    if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    await this.db.query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1",
      [row.id],
    );
    return {
      identityToken: await this.issueIdentityToken(row.user_id),
      refreshToken: await this.issueRefreshToken(row.user_id),
    };
  }

  /** The public profile for the authenticated user. */
  async me(userId: string): Promise<PublicUser> {
    const res = await this.db.query(
      "SELECT id, email, full_name, avatar_url FROM users WHERE id = $1",
      [userId],
    );
    const user = res.rows[0] as
      | Omit<UserRow, "password_hash" | "status">
      | undefined;
    if (!user) throw new UnauthorizedException();
    return toPublicUser(user);
  }

  /**
   * The active memberships of a user, as workspace summaries. Runs under
   * withUser so the memberships `membership_read` user_id arm and the
   * `workspace_member_read` policy grant exactly the caller's rows.
   */
  async listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
    return this.db.withUser(userId, async (client) => {
      const res = await client.query(
        `SELECT w.id, w.name, w.slug, w.color, w.avatar_url, m.role
         FROM memberships m
         JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.user_id = $1 AND m.status = 'active'
         ORDER BY w.created_at`,
        [userId],
      );
      return res.rows.map(toWorkspaceSummary);
    });
  }

  /**
   * Exchange an identity for a workspace-scoped access token. Verifies the
   * caller has an ACTIVE membership in the target workspace (checked under
   * withUser, so RLS itself only reveals the caller's own memberships) and
   * bakes their role into the token. 403 if they are not an active member.
   * Returns the token and the workspace summary for the client to activate.
   */
  async issueAccessToken(
    userId: string,
    workspaceId: string,
  ): Promise<{ accessToken: string; workspace: WorkspaceSummary }> {
    const row = await this.db.withUser(userId, async (client) => {
      const res = await client.query(
        `SELECT w.id, w.name, w.slug, w.color, w.avatar_url, m.role, m.status
         FROM memberships m
         JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.workspace_id = $1 AND m.user_id = $2`,
        [workspaceId, userId],
      );
      return res.rows[0] as
        | {
            id: string;
            name: string;
            slug: string;
            color: string;
            avatar_url: string | null;
            role: Role;
            status: string;
          }
        | undefined;
    });
    if (!row || row.status !== "active") {
      throw new ForbiddenException("No active membership in this workspace");
    }
    const claims: WorkspaceTokenClaims = {
      sub: userId,
      wsp: workspaceId,
      rol: row.role,
      typ: "access",
    };
    const accessToken = await this.jwt.signAsync(claims, {
      expiresIn: this.config.accessTtl,
    });
    return { accessToken, workspace: toWorkspaceSummary(row) };
  }

  /** Short-lived identity token: authorizes workspace list/create/select. */
  private async issueIdentityToken(userId: string): Promise<string> {
    const claims: IdentityTokenClaims = { sub: userId, typ: "identity" };
    return this.jwt.signAsync(claims, { expiresIn: this.config.accessTtl });
  }

  /**
   * Opaque 32-byte token; only its SHA-256 hash is persisted, so a DB dump
   * never yields a usable token. The plaintext is returned to the client
   * once and never stored.
   */
  private async issueRefreshToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + this.config.refreshTtl * 1000);
    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, sha256(token), expires],
    );
    return token;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toPublicUser(row: {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
  };
}

function toWorkspaceSummary(row: {
  id: string;
  name: string;
  slug: string;
  color: string;
  avatar_url: string | null;
  role: Role;
}): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    avatarUrl: row.avatar_url,
    role: row.role,
  };
}
