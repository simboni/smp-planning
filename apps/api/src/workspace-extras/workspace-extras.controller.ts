import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { WorkspaceExtrasService } from "./workspace-extras.service";

/**
 * Module 14: per-space ClickApps and per-user Favorites. Workspace-scoped;
 * ClickApps are gated by the space (view to read, edit to write); Favorites
 * are scoped to the token's own user.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class WorkspaceExtrasController {
  constructor(private readonly extras: WorkspaceExtrasService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  // --- ClickApps ------------------------------------------------------------

  @Get("spaces/:id/clickapps")
  getClickApps(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.extras.getClickApps(...this.ctx(req), id);
  }

  @Put("spaces/:id/clickapps")
  setClickApps(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { clickapps?: Record<string, unknown> },
  ) {
    return this.extras.setClickApps(...this.ctx(req), id, body ?? {});
  }

  // --- Favorites ------------------------------------------------------------

  @Get("favorites")
  async listFavorites(@Req() req: AuthedRequest) {
    return { favorites: await this.extras.listFavorites(...this.ctx(req)) };
  }

  @Post("favorites")
  @HttpCode(201)
  async addFavorite(
    @Req() req: AuthedRequest,
    @Body() body: { entityType?: string; entityId?: string },
  ) {
    return {
      favorite: await this.extras.addFavorite(...this.ctx(req), body ?? {}),
    };
  }

  @Delete("favorites/:entityType/:entityId")
  @HttpCode(204)
  async removeFavorite(
    @Req() req: AuthedRequest,
    @Param("entityType") entityType: string,
    @Param("entityId", ParseUUIDPipe) entityId: string,
  ) {
    await this.extras.removeFavorite(
      req.workspaceId!,
      req.userId!,
      entityType,
      entityId,
    );
  }
}
