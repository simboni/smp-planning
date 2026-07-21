import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { roleAtLeast } from "@stackup/shared";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { EmailService } from "./email.service";
import { SlackService } from "./slack.service";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Module 22 — comms & integrations surface: read the active email-delivery
 * provider and manage the workspace's Slack integration. Slack writes are
 * admin-gated inside the service (role from the access token).
 */
@Controller("integrations")
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class CommsController {
  constructor(
    private readonly email: EmailService,
    private readonly slack: SlackService,
  ) {}

  @Get("email")
  emailStatus() {
    return { provider: this.email.providerName(), configured: this.email.configured() };
  }

  /** Send a test email (admin only) so delivery can be verified end-to-end. */
  @Post("email/test")
  @HttpCode(200)
  async testEmail(
    @Req() req: AuthedRequest,
    @Body() body: { to?: string },
  ) {
    if (!roleAtLeast(req.role!, "admin")) {
      throw new ForbiddenException("Only admins can send a test email");
    }
    const to = (body?.to ?? "").trim();
    if (!EMAIL_RE.test(to)) {
      throw new BadRequestException("A valid recipient email is required");
    }
    return this.email.sendTest(to);
  }

  @Get("slack")
  async slackConfig(@Req() req: AuthedRequest) {
    return this.slack.getConfig(req.workspaceId!, req.userId!);
  }

  @Put("slack")
  async setSlack(
    @Req() req: AuthedRequest,
    @Body() body: { webhookUrl?: string; events?: string[]; active?: boolean },
  ) {
    return this.slack.setConfig(req.workspaceId!, req.userId!, req.role!, body);
  }

  @Delete("slack")
  @HttpCode(204)
  async removeSlack(@Req() req: AuthedRequest) {
    await this.slack.remove(req.workspaceId!, req.userId!, req.role!);
  }

  @Post("slack/test")
  @HttpCode(200)
  async testSlack(@Req() req: AuthedRequest) {
    return this.slack.test(req.workspaceId!, req.userId!, req.role!);
  }
}
