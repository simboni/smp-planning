import { Module } from "@nestjs/common";
import { PushModule } from "../push/push.module";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";

/**
 * Module 6: the per-user notifications inbox and reminders. Notification
 * ROWS are written by other features (comments, task assignment) via
 * inbox.support.ts inside their own transactions; this module reads, acks,
 * manages reminders — and bridges `notification.new` events to mobile push
 * (PushModule) after the writer's transaction commits. DbModule/EventsModule
 * are @Global.
 */
@Module({
  imports: [PushModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
