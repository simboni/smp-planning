import { Module } from "@nestjs/common";
import { CommsController } from "./comms.controller";
import { EmailService } from "./email.service";
import { SlackClient } from "./slack.client";
import { SlackService } from "./slack.service";

/**
 * Module 22 — Comms & integrations. Pluggable email delivery (EmailService)
 * and the workspace Slack integration (SlackService taps the event bus).
 * EmailService/SlackClient are exported so other modules can send mail or be
 * overridden in tests. DbModule and EventsModule are @Global.
 */
@Module({
  controllers: [CommsController],
  providers: [EmailService, SlackService, SlackClient],
  exports: [EmailService, SlackClient],
})
export class CommsModule {}
