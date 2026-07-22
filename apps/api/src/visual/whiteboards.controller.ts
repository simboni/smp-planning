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
import { WhiteboardsService } from "./whiteboards.service";

/**
 * Module 12: Whiteboards. Workspace-scoped; the docs-like visibility rules
 * (space-attached follows the space, unattached for all members, guests
 * excluded) live in the service.
 */
@Controller("whiteboards")
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class WhiteboardsController {
  constructor(private readonly whiteboards: WhiteboardsService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  @Get()
  async list(@Req() req: AuthedRequest) {
    return { whiteboards: await this.whiteboards.list(...this.ctx(req)) };
  }

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      name?: string;
      spaceId?: string;
      elements?: unknown;
      folderId?: string | null;
      listId?: string | null;
      taskId?: string | null;
    },
  ) {
    return {
      whiteboard: await this.whiteboards.create(...this.ctx(req), body ?? {}),
    };
  }

  @Get(":id")
  async get(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { whiteboard: await this.whiteboards.get(...this.ctx(req), id) };
  }

  @Patch(":id")
  async update(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      elements?: unknown;
      spaceId?: string | null;
      folderId?: string | null;
      listId?: string | null;
      taskId?: string | null;
    },
  ) {
    return {
      whiteboard: await this.whiteboards.update(
        ...this.ctx(req),
        id,
        body ?? {},
      ),
    };
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.whiteboards.remove(...this.ctx(req), id);
  }
}
