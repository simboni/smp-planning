import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { IdentityTokenClaims, Role } from "@stackup/shared";
import { ROLES } from "@stackup/shared";
import {
  AuthedRequest,
  CurrentAuth,
  IdentityGuard,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  WorkspaceGuard,
} from "../auth/guards";
import { WorkspacesService } from "./workspaces.service";

@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  // --- Identity surface: needs any valid token, no workspace selected yet ---

  @Get()
  @UseGuards(JwtAuthGuard, IdentityGuard)
  async list(@CurrentAuth() auth: IdentityTokenClaims) {
    return { workspaces: await this.workspaces.list(auth.sub) };
  }

  @Post()
  @UseGuards(JwtAuthGuard, IdentityGuard)
  async create(
    @CurrentAuth() auth: IdentityTokenClaims,
    @Body() body: { name?: string },
  ) {
    if (!body?.name?.trim()) {
      throw new BadRequestException("Workspace name is required");
    }
    return { workspace: await this.workspaces.create(auth.sub, body.name) };
  }

  @Post(":id/token")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, IdentityGuard)
  async token(
    @CurrentAuth() auth: IdentityTokenClaims,
    @Param("id", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspaces.token(auth.sub, workspaceId);
  }

  // --- Workspace surface: needs an access token (WorkspaceGuard) ---

  @Get("current")
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async current(@Req() req: AuthedRequest) {
    return this.workspaces.current(req.workspaceId!, req.userId!);
  }

  @Patch("current")
  @UseGuards(JwtAuthGuard, WorkspaceGuard, RolesGuard)
  @Roles("admin") // owner + admin
  async update(
    @Req() req: AuthedRequest,
    @Body() body: { name?: string; color?: string; avatarUrl?: string | null },
  ) {
    return {
      workspace: await this.workspaces.update(req.workspaceId!, req.userId!, body),
    };
  }

  @Delete("current")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, WorkspaceGuard, RolesGuard)
  @Roles("owner") // owner only — permanently destroys the whole tenant
  async remove(@Req() req: AuthedRequest) {
    await this.workspaces.remove(req.workspaceId!, req.userId!);
  }

  @Get("current/members")
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async members(@Req() req: AuthedRequest) {
    return { members: await this.workspaces.members(req.workspaceId!, req.userId!) };
  }

  @Post("current/members")
  @UseGuards(JwtAuthGuard, WorkspaceGuard, RolesGuard)
  @Roles("admin") // owner + admin (meet-or-exceed)
  async addMember(
    @Req() req: AuthedRequest,
    @Body() body: { email?: string; role?: Role },
  ) {
    const role = body?.role;
    if (!body?.email?.trim()) {
      throw new BadRequestException("email is required");
    }
    if (!role || !ROLES.includes(role) || role === "owner") {
      throw new BadRequestException(
        "role must be one of 'member', 'admin' or 'guest'",
      );
    }
    return this.workspaces.addMember(
      req.workspaceId!,
      req.userId!,
      body.email,
      role,
    );
  }
}
