import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

/**
 * Module 13: Chat (channels + DMs, threaded messages, reactions), SyncUp
 * huddle markers and task email. Members-only; guests are refused in the
 * service. DbModule and EventsModule are @Global; AccessModule gates task
 * email by space, AuditModule records channel/message/email mutations.
 */
@Module({
  imports: [AccessModule, AuditModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
