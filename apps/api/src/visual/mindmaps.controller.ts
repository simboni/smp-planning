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
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { MindmapsService } from "./mindmaps.service";

/**
 * Module 12: Mind maps. Same access model as whiteboards (space-attached
 * follows the space, unattached for all members, guests excluded).
 */
@Controller("mindmaps")
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class MindmapsController {
  constructor(private readonly mindmaps: MindmapsService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  @Get()
  async list(@Req() req: AuthedRequest) {
    return { mindmaps: await this.mindmaps.list(...this.ctx(req)) };
  }

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Body() body: { name?: string; spaceId?: string },
  ) {
    return {
      mindmap: await this.mindmaps.create(...this.ctx(req), body ?? {}),
    };
  }

  @Get(":id")
  async get(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { mindmap: await this.mindmaps.get(...this.ctx(req), id) };
  }

  @Patch(":id")
  async update(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; root?: unknown; spaceId?: string | null },
  ) {
    return {
      mindmap: await this.mindmaps.update(...this.ctx(req), id, body ?? {}),
    };
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.mindmaps.remove(...this.ctx(req), id);
  }
}
