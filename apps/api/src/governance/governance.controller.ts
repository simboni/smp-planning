import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Role } from "@stackup/shared";
import {
  AuthedRequest,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  WorkspaceGuard,
} from "../auth/guards";
import { GovernanceService } from "./governance.service";

/**
 * Governance surface (Module 17). Custom-role management is admin-only
 * (RolesGuard + @Roles('admin')). The audit read endpoints are guarded by the
 * viewAuditLog capability inside the service, so a custom role that grants it
 * can reach them even below admin.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class GovernanceController {
  constructor(private readonly gov: GovernanceService) {}

  // --- custom roles (admin) ------------------------------------------------

  @Get("governance/roles")
  async listRoles(@Req() req: AuthedRequest) {
    return { roles: await this.gov.listRoles(req.workspaceId!, req.userId!) };
  }

  @Post("governance/roles")
  @UseGuards(RolesGuard)
  @Roles("admin")
  async createRole(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      name?: string;
      description?: string;
      baseRole?: Role;
      capabilities?: Record<string, boolean>;
    },
  ) {
    return {
      role: await this.gov.createRole(req.workspaceId!, req.userId!, body),
    };
  }

  @Patch("governance/roles/:id")
  @UseGuards(RolesGuard)
  @Roles("admin")
  async updateRole(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: { name?: string; description?: string; capabilities?: Record<string, boolean> },
  ) {
    return {
      role: await this.gov.updateRole(req.workspaceId!, req.userId!, id, body),
    };
  }

  @Delete("governance/roles/:id")
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @Roles("admin")
  async deleteRole(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.gov.deleteRole(req.workspaceId!, req.userId!, id);
  }

  @Post("governance/members/:userId/role")
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @Roles("admin")
  async assignRole(
    @Req() req: AuthedRequest,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() body: { customRoleId?: string | null },
  ) {
    await this.gov.assignRole(
      req.workspaceId!,
      req.userId!,
      userId,
      body?.customRoleId ?? null,
    );
  }

  // --- audit log (viewAuditLog capability, enforced in service) ------------

  @Get("audit")
  async listAudit(
    @Req() req: AuthedRequest,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("action") action?: string,
    @Query("entity") entity?: string,
    @Query("actorUserId") actorUserId?: string,
  ) {
    return this.gov.listAudit(req.workspaceId!, req.userId!, req.role!, {
      limit: limit ? Number(limit) : undefined,
      cursor,
      action,
      entity,
      actorUserId,
    });
  }

  @Get("audit/verify")
  async verifyAudit(@Req() req: AuthedRequest) {
    return this.gov.verifyAudit(req.workspaceId!, req.userId!, req.role!);
  }
}
