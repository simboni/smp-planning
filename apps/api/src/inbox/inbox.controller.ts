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
import {
  AuthedRequest,
  JwtAuthGuard,
  WorkspaceGuard,
} from "../auth/guards";
import { InboxService } from "./inbox.service";

/**
 * Module 6: notifications inbox + reminders. Workspace-scoped and always the
 * caller's own rows — the service filters by the token's user id, so there
 * is no cross-user surface here at all.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!] as const;
  }

  // --- Notifications --------------------------------------------------------

  @Get("notifications")
  async listNotifications(
    @Req() req: AuthedRequest,
    @Query("unread") unread?: string,
  ) {
    return this.inbox.listNotifications(
      ...this.ctx(req),
      unread === "1" || unread === "true",
    );
  }

  @Post("notifications/:id/read")
  @HttpCode(200)
  async markRead(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.inbox.markRead(...this.ctx(req), id);
    return { ok: true };
  }

  @Post("notifications/read-all")
  @HttpCode(200)
  async markAllRead(@Req() req: AuthedRequest) {
    await this.inbox.markAllRead(...this.ctx(req));
    return { ok: true };
  }

  // --- Reminders ------------------------------------------------------------

  @Get("reminders")
  async listReminders(@Req() req: AuthedRequest) {
    return { reminders: await this.inbox.listReminders(...this.ctx(req)) };
  }

  @Post("reminders")
  async createReminder(
    @Req() req: AuthedRequest,
    @Body() body: { note?: string; remindAt?: string; taskId?: string | null },
  ) {
    return {
      reminder: await this.inbox.createReminder(...this.ctx(req), body ?? {}),
    };
  }

  @Patch("reminders/:id")
  async updateReminder(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { note?: string; remindAt?: string; done?: boolean },
  ) {
    return {
      reminder: await this.inbox.updateReminder(...this.ctx(req), id, body ?? {}),
    };
  }

  @Delete("reminders/:id")
  @HttpCode(204)
  async deleteReminder(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.inbox.deleteReminder(...this.ctx(req), id);
  }
}
