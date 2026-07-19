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
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { ChatService } from "./chat.service";

/**
 * Module 13: Chat, SyncUps and task email. Every route is workspace-scoped
 * (JwtAuthGuard + WorkspaceGuard); the service refuses guests on chat/DM
 * routes and gates task email by the owning space's permission.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  // --- Channels & DMs -------------------------------------------------------

  @Get("channels")
  listChannels(@Req() req: AuthedRequest) {
    return this.chat.listChannels(...this.ctx(req));
  }

  @Get("channels/public")
  listPublicChannels(@Req() req: AuthedRequest) {
    return this.chat.listPublicChannels(...this.ctx(req));
  }

  @Post("channels")
  createChannel(
    @Req() req: AuthedRequest,
    @Body() body: { name?: string; description?: string },
  ) {
    return this.chat.createChannel(...this.ctx(req), body ?? {});
  }

  @Post("channels/:id/join")
  @HttpCode(200)
  joinChannel(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.chat.joinChannel(...this.ctx(req), id);
  }

  @Post("channels/:id/leave")
  @HttpCode(200)
  leaveChannel(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.chat.leaveChannel(...this.ctx(req), id);
  }

  @Post("dms")
  openDm(@Req() req: AuthedRequest, @Body() body: { userId?: string }) {
    return this.chat.openDm(...this.ctx(req), body ?? {});
  }

  @Post("channels/:id/read")
  @HttpCode(200)
  markRead(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.chat.markRead(...this.ctx(req), id);
  }

  // --- Messages -------------------------------------------------------------

  @Get("channels/:id/messages")
  listMessages(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("before") before?: string,
    @Query("limit") limit?: string,
  ) {
    return this.chat.listMessages(...this.ctx(req), id, {
      before,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("messages/:id/thread")
  getThread(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.chat.getThread(...this.ctx(req), id);
  }

  @Post("channels/:id/messages")
  createMessage(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { body?: string; parentMessageId?: string },
  ) {
    return this.chat.createMessage(...this.ctx(req), id, body ?? {});
  }

  @Patch("messages/:id")
  updateMessage(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { body?: string },
  ) {
    return this.chat.updateMessage(...this.ctx(req), id, body ?? {});
  }

  @Delete("messages/:id")
  @HttpCode(204)
  async deleteMessage(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.chat.deleteMessage(...this.ctx(req), id);
  }

  @Post("messages/:id/reactions")
  @HttpCode(200)
  toggleReaction(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { emoji?: string },
  ) {
    return this.chat.toggleReaction(...this.ctx(req), id, body ?? {});
  }

  // --- SyncUps --------------------------------------------------------------

  @Post("channels/:id/syncup/start")
  startSyncup(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.chat.startSyncup(...this.ctx(req), id);
  }

  @Post("syncups/:id/end")
  @HttpCode(200)
  endSyncup(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.chat.endSyncup(...this.ctx(req), id);
  }

  @Get("channels/:id/syncup")
  getSyncup(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.chat.getSyncup(...this.ctx(req), id);
  }

  // --- Task email -----------------------------------------------------------

  @Post("tasks/:id/emails")
  composeEmail(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { to?: string; subject?: string; body?: string },
  ) {
    return this.chat.composeEmail(...this.ctx(req), id, body ?? {});
  }

  @Get("tasks/:id/emails")
  listEmails(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.chat.listEmails(...this.ctx(req), id);
  }
}
