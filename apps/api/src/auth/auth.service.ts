import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { authenticator } from "otplib";
import * as QRCode from "qrcode";
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
import { GoogleOAuthClient } from "./google-oauth.client";

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
  totp_enabled?: boolean;
  totp_secret?: string | null;
}

/** Returned by login when the account has 2FA on: verify a code to finish. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  /** Short-lived token that authorizes the /auth/2fa/login step for this user. */
  challengeToken: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  current: boolean;
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
    private readonly google: GoogleOAuthClient,
  ) {}

  /**
   * Register a new identity. A brand-new user belongs to no workspace yet,
   * so we return an empty workspaces list; they create or are invited to one
   * next. 409 on a duplicate email (case-insensitive, enforced by the
   * users_email_key unique index on lower(email)).
   */
  async signup(input: SignupInput, userAgent?: string): Promise<AuthResult> {
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
      refreshToken: await this.issueRefreshToken(user.id, userAgent),
      user: toPublicUser(user),
      workspaces: [],
    };
  }

  // --- SSO (Module 18): Google OAuth ---------------------------------------

  /** Which SSO providers are configured (drives the login-page buttons). */
  ssoProviders(): { google: boolean } {
    return { google: this.google.configured() };
  }

  /**
   * Begin the Google OAuth flow: mint a short-lived, signed `state` (CSRF
   * defense — the callback verifies it) and return the consent-screen URL.
   */
  googleAuthUrl(): { url: string } {
    const state = this.jwt.sign(
      { typ: "oauthstate", nonce: randomBytes(8).toString("hex") },
      { expiresIn: 600 },
    );
    return { url: this.google.authorizeUrl(state) };
  }

  /**
   * Complete the Google OAuth flow. Verifies the state token, exchanges the
   * code for the user's verified Google profile, then finds-or-creates the
   * local account:
   *   1. a user already linked to this Google subject -> sign in;
   *   2. otherwise a user with the same (verified) email -> link + sign in;
   *   3. otherwise create a new user linked to Google.
   * Requires Google to have verified the email (else we could hijack an
   * account by asserting an unowned address).
   */
  async googleCallback(
    code: string,
    state: string,
    userAgent?: string,
  ): Promise<AuthResult> {
    try {
      const claims = await this.jwt.verifyAsync<{ typ: string }>(state);
      if (claims.typ !== "oauthstate") throw new Error("wrong token type");
    } catch {
      throw new UnauthorizedException("Your sign-in session expired — start again");
    }
    if (!code) throw new BadRequestException("Missing authorization code");

    const profile = await this.google.exchange(code);
    if (!profile.emailVerified) {
      throw new UnauthorizedException("Your Google email is not verified");
    }

    // 1. Already linked?
    const linked = await this.db.query(
      `SELECT id, email, full_name, avatar_url, password_hash, status
         FROM users WHERE oauth_provider = 'google' AND oauth_subject = $1`,
      [profile.sub],
    );
    let user = linked.rows[0] as UserRow | undefined;

    if (!user) {
      // 2. Existing account with the same email -> link it.
      const byEmail = await this.db.query(
        `SELECT id, email, full_name, avatar_url, password_hash, status
           FROM users WHERE lower(email) = lower($1)`,
        [profile.email],
      );
      const existing = byEmail.rows[0] as UserRow | undefined;
      if (existing) {
        const upd = await this.db.query(
          `UPDATE users
              SET oauth_provider = 'google',
                  oauth_subject  = $2,
                  avatar_url     = COALESCE(avatar_url, $3)
            WHERE id = $1 AND (oauth_provider IS NULL OR oauth_provider = 'google')
            RETURNING id, email, full_name, avatar_url, password_hash, status`,
          [existing.id, profile.sub, profile.picture],
        );
        user = upd.rows[0] as UserRow | undefined;
        if (!user) {
          // Row was linked to a different provider identity — refuse silently.
          throw new UnauthorizedException("This email is linked to a different sign-in");
        }
      } else {
        // 3. Brand-new user. OAuth accounts carry an unusable random password.
        const unusable = await argon2.hash(randomBytes(24).toString("hex"), {
          type: argon2.argon2id,
        });
        const created = await this.db.query(
          `INSERT INTO users (email, password_hash, full_name, avatar_url, oauth_provider, oauth_subject)
             VALUES ($1, $2, $3, $4, 'google', $5)
             RETURNING id, email, full_name, avatar_url, password_hash, status`,
          [
            profile.email.trim(),
            unusable,
            (profile.name ?? profile.email.split("@")[0]).trim(),
            profile.picture,
            profile.sub,
          ],
        );
        user = created.rows[0] as UserRow;
      }
    }

    if (user.status !== "active") {
      throw new UnauthorizedException("This account is not active");
    }
    return this.completeLogin(user, userAgent);
  }

  /**
   * Authenticate by email + password and load the caller's workspaces so a
   * client can render the picker immediately. 401 (generic) on any failure —
   * unknown email, wrong password, or a non-active account — to avoid
   * leaking which emails exist.
   */
  async login(
    email: string,
    password: string,
    userAgent?: string,
  ): Promise<AuthResult | TwoFactorChallenge> {
    const res = await this.db.query(
      `SELECT id, email, full_name, avatar_url, password_hash, status,
              totp_enabled, totp_secret
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
    // 2FA on: don't hand out tokens yet — issue a short-lived challenge the
    // client redeems with a valid TOTP code via /auth/2fa/login.
    if (user.totp_enabled) {
      const challengeToken = await this.jwt.signAsync(
        { sub: user.id, typ: "twofa" },
        { expiresIn: 300 },
      );
      return { twoFactorRequired: true, challengeToken };
    }
    return this.completeLogin(user, userAgent);
  }

  /** Finish a 2FA login: verify the challenge token + TOTP code, mint tokens. */
  async login2fa(
    challengeToken: string,
    code: string,
    userAgent?: string,
  ): Promise<AuthResult> {
    let sub: string;
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; typ: string }>(
        challengeToken,
      );
      if (claims.typ !== "twofa") throw new Error("wrong token type");
      sub = claims.sub;
    } catch {
      throw new UnauthorizedException("Your sign-in session expired — start again");
    }
    const user = await this.userRow(sub);
    if (!user || !user.totp_enabled || !user.totp_secret) {
      throw new UnauthorizedException("Two-factor is not enabled");
    }
    if (!verifyTotp(user.totp_secret, code)) {
      throw new UnauthorizedException("That code isn't right — try the current one");
    }
    return this.completeLogin(user, userAgent);
  }

  private async completeLogin(
    user: UserRow,
    userAgent?: string,
  ): Promise<AuthResult> {
    return {
      identityToken: await this.issueIdentityToken(user.id),
      refreshToken: await this.issueRefreshToken(user.id, userAgent),
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
    userAgent?: string,
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
      refreshToken: await this.issueRefreshToken(row.user_id, userAgent),
    };
  }

  /* ---- Two-factor authentication (TOTP) ---------------------------- */

  /** Whether the caller has 2FA enabled. */
  async twoFactorStatus(userId: string): Promise<{ enabled: boolean }> {
    const u = await this.userRow(userId);
    return { enabled: !!u?.totp_enabled };
  }

  /**
   * Begin enrollment: generate a fresh secret (stored but NOT yet enabled) and
   * return the otpauth URI + a QR data-URL to show in an authenticator app.
   * Enrollment only takes effect once a code is confirmed via enable2fa.
   */
  async enroll2fa(
    userId: string,
  ): Promise<{ otpauthUri: string; qrDataUrl: string }> {
    const user = await this.userRow(userId);
    if (!user) throw new UnauthorizedException();
    const secret = authenticator.generateSecret();
    await this.db.query(
      "UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2",
      [secret, userId],
    );
    const otpauthUri = authenticator.keyuri(user.email, "StackUp", secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUri);
    return { otpauthUri, qrDataUrl };
  }

  /** Confirm enrollment with a code from the app; turns 2FA on. */
  async enable2fa(userId: string, code: string): Promise<{ enabled: true }> {
    const user = await this.userRow(userId);
    if (!user?.totp_secret) {
      throw new BadRequestException("Start 2FA setup first");
    }
    if (!verifyTotp(user.totp_secret, code)) {
      throw new BadRequestException("That code isn't right — try the current one");
    }
    await this.db.query(
      "UPDATE users SET totp_enabled = true WHERE id = $1",
      [userId],
    );
    return { enabled: true };
  }

  /** Turn 2FA off (requires a current code to prove possession). */
  async disable2fa(userId: string, code: string): Promise<{ enabled: false }> {
    const user = await this.userRow(userId);
    if (!user?.totp_enabled || !user.totp_secret) return { enabled: false };
    if (!verifyTotp(user.totp_secret, code)) {
      throw new BadRequestException("That code isn't right — try the current one");
    }
    await this.db.query(
      "UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1",
      [userId],
    );
    return { enabled: false };
  }

  /* ---- Session management ------------------------------------------ */

  /** Active (unrevoked, unexpired) sessions for the caller, newest first. */
  async listSessions(
    userId: string,
    currentRefreshToken?: string,
  ): Promise<SessionInfo[]> {
    const currentHash = currentRefreshToken ? sha256(currentRefreshToken) : null;
    const res = await this.db.query(
      `SELECT id, token_hash, user_agent, last_used_at, created_at
       FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC`,
      [userId],
    );
    return res.rows.map((r) => ({
      id: r.id as string,
      userAgent: r.user_agent as string | null,
      lastUsedAt: r.last_used_at as string | null,
      createdAt: r.created_at as string,
      current: currentHash != null && r.token_hash === currentHash,
    }));
  }

  /** Revoke one session (sign that device out). */
  async revokeSession(userId: string, id: string): Promise<void> {
    const res = await this.db.query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
      [id, userId],
    );
    if ((res.rowCount ?? 0) === 0) throw new NotFoundException("Session not found");
  }

  private async userRow(userId: string): Promise<UserRow | undefined> {
    const res = await this.db.query(
      `SELECT id, email, full_name, avatar_url, password_hash, status,
              totp_enabled, totp_secret
       FROM users WHERE id = $1`,
      [userId],
    );
    return res.rows[0] as UserRow | undefined;
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
  private async issueRefreshToken(
    userId: string,
    userAgent?: string,
  ): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + this.config.refreshTtl * 1000);
    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, last_used_at)
       VALUES ($1, $2, $3, $4, now())`,
      [userId, sha256(token), expires, (userAgent ?? "").slice(0, 400) || null],
    );
    return token;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Verify a 6-digit TOTP code against a base32 secret (±1 step window). */
function verifyTotp(secret: string, code: string): boolean {
  const clean = (code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  try {
    authenticator.options = { window: 1 };
    return authenticator.verify({ token: clean, secret });
  } catch {
    return false;
  }
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
