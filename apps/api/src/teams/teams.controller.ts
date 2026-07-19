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
import {
  AuthedRequest,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  WorkspaceGuard,
} from "../auth/guards";
import { TeamsService } from "./teams.service";

/**
 * Teams (user groups). Every route is workspace-scoped. Reads are open to any
 * member; team management (create / rename / delete / membership) requires
 * @Roles('admin') — i.e. owner or admin (meet-or-exceed).
 */
@Controller("teams")
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    return { teams: await this.teams.list(req.workspaceId!, req.userId!) };
  }

  @Get(":id")
  async detail(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.teams.detail(req.workspaceId!, req.userId!, id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles("admin")
  async create(
    @Req() req: AuthedRequest,
    @Body()
    body: { name?: string; color?: string; memberUserIds?: string[] },
  ) {
    return {
      team: await this.teams.create(req.workspaceId!, req.userId!, body ?? {}),
    };
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles("admin")
  async update(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; color?: string },
  ) {
    return {
      team: await this.teams.update(
        req.workspaceId!,
        req.userId!,
        id,
        body ?? {},
      ),
    };
  }

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @Roles("admin")
  async remove(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.teams.remove(req.workspaceId!, req.userId!, id);
  }

  @Post(":id/members")
  @UseGuards(RolesGuard)
  @Roles("admin")
  async addMember(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { userId?: string },
  ) {
    await this.teams.addMember(
      req.workspaceId!,
      req.userId!,
      id,
      body?.userId ?? "",
    );
    return { ok: true };
  }

  @Delete(":id/members/:userId")
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @Roles("admin")
  async removeMember(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    await this.teams.removeMember(req.workspaceId!, req.userId!, id, userId);
  }
}
