import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { DocsController } from "./docs.controller";
import { DocsService } from "./docs.service";

/**
 * Module 7: Docs, wikis & Notepad — Docs with nested Pages (space-attached,
 * workspace-wide, or private-to-creator) plus the per-user Notepad. Space
 * gating via AccessModule, audit via AuditModule; DbModule and EventsModule
 * are @Global so the service injects them freely.
 */
@Module({
  imports: [AccessModule, AuditModule],
  controllers: [DocsController],
  providers: [DocsService],
  exports: [DocsService],
})
export class DocsModule {}
