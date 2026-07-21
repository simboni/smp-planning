import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type {
  IdentityTokenClaims,
  Role,
  WorkspaceTokenClaims,
} from "@stackup/shared";
import { roleAtLeast } from "@stackup/shared";

/** Either token type may authenticate a request; handlers narrow by `typ`. */
export type AuthClaims = IdentityTokenClaims | WorkspaceTokenClaims;

export interface AuthedRequest extends Request {
  auth?: AuthClaims;
  // Populated by WorkspaceGuard for workspace-scoped handlers.
  workspaceId?: string;
  userId?: string;
  role?: Role;
}

/**
 * Verifies the bearer token and attaches the decoded claims to req.auth.
 * Only a *credential* token — an identity or access token — passes; the
 * short-lived `twofa` challenge and `oauthstate` tokens are signed with the
 * same key but must never authenticate a request (accepting the challenge
 * token would let a caller who has passed the password step but not the
 * second factor reach authenticated endpoints, e.g. rotate their TOTP
 * secret). Later guards narrow further by token type. The verify pins HS256
 * so a future asymmetric key can't enable an alg-confusion downgrade. 401 on
 * a missing, invalid, or non-credential token.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new UnauthorizedException("Missing bearer token");
    let claims: AuthClaims;
    try {
      claims = await this.jwt.verifyAsync<AuthClaims>(token, {
        algorithms: ["HS256"],
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    if (claims.typ !== "identity" && claims.typ !== "access") {
      throw new UnauthorizedException("A valid credential token is required");
    }
    req.auth = claims;
    return true;
  }
}

/**
 * Accepts an identity OR an access token. Used for the pre-workspace
 * surface (list / create / select a workspace, /auth/me): an access-token
 * holder is also a valid identity, so they need not step back down to an
 * identity token to see or switch workspaces. Use after JwtAuthGuard.
 */
@Injectable()
export class IdentityGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const typ = req.auth?.typ;
    if (typ !== "identity" && typ !== "access") {
      throw new UnauthorizedException("A valid identity is required");
    }
    return true;
  }
}

/**
 * Requires a workspace-scoped access token and projects its claims onto the
 * request (workspaceId / userId / role) for handlers and RolesGuard. An
 * identity token is rejected — select a workspace first. Use after
 * JwtAuthGuard.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const auth = req.auth;
    if (auth?.typ !== "access") {
      throw new UnauthorizedException(
        "Select a workspace first (access token required)",
      );
    }
    req.workspaceId = auth.wsp;
    req.userId = auth.sub;
    req.role = auth.rol;
    return true;
  }
}

export const ROLES_KEY = "roles";
/**
 * Restrict a workspace-scoped route to the given roles. The listed role is
 * the MINIMUM: any strictly more privileged role is also allowed
 * (owner > admin > member > guest), so @Roles('admin') admits owner + admin.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Enforces @Roles(...) against the access token's role. Deny by default. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const role = req.role;
    // Meet-or-exceed against any listed role: @Roles('admin') passes owner too.
    if (!role || !required.some((r) => roleAtLeast(role, r))) {
      throw new ForbiddenException("Insufficient role for this action");
    }
    return true;
  }
}

/** Injects the verified claims (identity or access) into a handler param. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthClaims => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.auth) throw new UnauthorizedException();
    return req.auth;
  },
);
