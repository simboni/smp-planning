import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { CommentsController } from "./comments.controller";
import { CommentsService } from "./comments.service";

/**
 * Module 6: threaded comments with mentions, assigned comments and
 * resolution. Space gating via AccessModule, audit via AuditModule;
 * DbModule and EventsModule are @Global so the service injects them freely.
 */
@Module({
  imports: [AccessModule, AuditModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
