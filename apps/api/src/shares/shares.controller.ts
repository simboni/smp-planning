import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { SharesService } from "./shares.service";

/**
 * Module 26 — manage public share links for the caller's workspace.
 * Workspace-scoped; guests are refused inside the service.
 */
@Controller("shares")
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Get()
  async forEntity(
    @Req() req: AuthedRequest,
    @Query("type") type: string,
    @Query("id") id: string,
  ) {
    return {
      share: await this.shares.forEntity(req.workspaceId!, req.userId!, type, id),
    };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Req() req: AuthedRequest,
    @Body() body: { entityType?: string; entityId?: string; permission?: string },
  ) {
    return {
      share: await this.shares.create(
        req.workspaceId!,
        req.userId!,
        req.role!,
        body ?? {},
      ),
    };
  }

  @Delete(":id")
  @HttpCode(204)
  async revoke(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.shares.revoke(req.workspaceId!, req.userId!, id);
  }
}
