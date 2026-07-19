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
import { ViewsService } from "./views.service";

/**
 * Module 5: saved views. Workspace-scoped (JwtAuthGuard + WorkspaceGuard);
 * space visibility and shared/personal write rules are enforced in the
 * service (404 when the owning space is not visible, 403 on weak permission).
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  @Get("lists/:id/views")
  async listViews(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) listId: string,
  ) {
    return { views: await this.views.listViews(...this.ctx(req), listId) };
  }

  @Post("lists/:id/views")
  async createView(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) listId: string,
    @Body()
    body: { name?: string; kind?: string; config?: unknown; isShared?: boolean },
  ) {
    return {
      view: await this.views.create(...this.ctx(req), listId, body ?? {}),
    };
  }

  @Patch("views/:id")
  async updateView(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: { name?: string; config?: unknown; isShared?: boolean; position?: number },
  ) {
    return { view: await this.views.update(...this.ctx(req), id, body ?? {}) };
  }

  @Delete("views/:id")
  @HttpCode(204)
  async deleteView(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.views.remove(...this.ctx(req), id);
  }
}
