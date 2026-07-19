import { Module } from "@nestjs/common";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";

/**
 * Module 6: the per-user notifications inbox and reminders. Notification
 * ROWS are written by other features (comments, task assignment) via
 * inbox.support.ts inside their own transactions; this module only reads,
 * acks and manages reminders. DbModule/EventsModule are @Global.
 */
@Module({
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
