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
import { DepartmentsService } from "./departments.service";

/**
 * Module HR — departments & designations. Every member can view the org
 * structure (guests can't); creating and managing departments and their
 * rosters is owner/admin work, matching the existing members endpoints.
 */
@Controller("departments")
@UseGuards(JwtAuthGuard, WorkspaceGuard, RolesGuard)
@Roles("member")
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    return {
      departments: await this.departments.list(req.workspaceId!, req.userId!),
    };
  }

  @Post()
  @Roles("admin")
  async create(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      name?: string;
      description?: string;
      color?: string;
      leadUserId?: string | null;
      createSpace?: boolean;
    },
  ) {
    return {
      department: await this.departments.create(
        req.workspaceId!,
        req.userId!,
        body ?? {},
      ),
    };
  }

  @Get(":id")
  async get(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return {
      department: await this.departments.get(req.workspaceId!, req.userId!, id),
    };
  }

  @Patch(":id")
  @Roles("admin")
  async update(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      color?: string;
      leadUserId?: string | null;
      spaceId?: string | null;
    },
  ) {
    return {
      department: await this.departments.update(
        req.workspaceId!,
        req.userId!,
        id,
        body ?? {},
      ),
    };
  }

  @Delete(":id")
  @Roles("admin")
  @HttpCode(204)
  async remove(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.departments.remove(req.workspaceId!, req.userId!, id);
  }

  @Post(":id/members")
  @Roles("admin")
  async addMember(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      userId?: string;
      email?: string;
      role?: Role;
      title?: string | null;
      deptRole?: string;
    },
  ) {
    return {
      member: await this.departments.addMember(
        req.workspaceId!,
        req.userId!,
        id,
        body ?? {},
      ),
    };
  }

  @Patch(":id/members/:userId")
  @Roles("admin")
  async updateMember(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() body: { deptRole?: string; title?: string | null },
  ) {
    await this.departments.updateMember(
      req.workspaceId!,
      req.userId!,
      id,
      userId,
      body ?? {},
    );
    return { ok: true };
  }

  @Delete(":id/members/:userId")
  @Roles("admin")
  @HttpCode(204)
  async removeMember(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    await this.departments.removeMember(
      req.workspaceId!,
      req.userId!,
      id,
      userId,
    );
  }
}
