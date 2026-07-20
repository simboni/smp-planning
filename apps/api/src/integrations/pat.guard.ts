import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Role } from "@stackup/shared";
import { PatScope, PatService } from "./pat.service";

export interface PatRequest extends Request {
  workspaceId?: string;
  userId?: string;
  role?: Role;
  patScope?: PatScope;
}

/**
 * Authenticates public-API requests with a Personal Access Token presented as
 * `Authorization: Bearer stackup_pat_…`. Resolves the token to its workspace,
 * user and role, then projects them onto the request. Read-scoped tokens may
 * only make safe (GET) calls; a write on a read token is 403. Unlike the JWT
 * guards this never accepts a session token — the public API is PAT-only.
 */
@Injectable()
export class PatGuard implements CanActivate {
  constructor(private readonly pat: PatService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PatRequest>();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new UnauthorizedException("Missing API token");
    const principal = await this.pat.resolve(token);
    if (!principal) throw new UnauthorizedException("Invalid API token");

    const method = req.method.toUpperCase();
    const isWrite = method !== "GET" && method !== "HEAD";
    if (isWrite && principal.scope !== "write") {
      throw new ForbiddenException("This token is read-only");
    }
    req.workspaceId = principal.workspaceId;
    req.userId = principal.userId;
    req.role = principal.role;
    req.patScope = principal.scope;
    return true;
  }
}
