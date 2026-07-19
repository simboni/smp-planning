import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  AuthedRequest,
  JwtAuthGuard,
  WorkspaceGuard,
} from "../auth/guards";
import { SharingService } from "./sharing.service";

/**
 * Space-level sharing endpoints. Reads/writes are gated by AccessService
 * (visibility for GET, canManage for mutations) rather than by role alone, so
 * a member granted a full share can administer that space. All routes are
 * workspace-scoped.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Get("spaces/:id/access")
  async access(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.sharing.access_(
      req.workspaceId!,
      req.userId!,
      req.role!,
      id,
    );
  }

  @Put("spaces/:id/privacy")
  async privacy(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { isPrivate?: boolean },
  ) {
    return this.sharing.setPrivacy(
      req.workspaceId!,
      req.userId!,
      req.role!,
      id,
      body?.isPrivate as boolean,
    );
  }

  @Put("spaces/:id/shares")
  async share(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: { principalType?: string; principalId?: string; permission?: string },
  ) {
    return {
      entry: await this.sharing.upsertShare(
        req.workspaceId!,
        req.userId!,
        req.role!,
        id,
        body ?? {},
      ),
    };
  }

  @Delete("spaces/:id/shares/:principalType/:principalId")
  @HttpCode(204)
  async unshare(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("principalType") principalType: string,
    @Param("principalId", ParseUUIDPipe) principalId: string,
  ) {
    await this.sharing.removeShare(
      req.workspaceId!,
      req.userId!,
      req.role!,
      id,
      principalType,
      principalId,
    );
  }
}
