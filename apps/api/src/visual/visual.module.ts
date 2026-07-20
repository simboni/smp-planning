import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { LimitsModule } from "../limits/limits.module";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { MindmapsController } from "./mindmaps.controller";
import { MindmapsService } from "./mindmaps.service";
import { ProofingController } from "./proofing.controller";
import { ProofingService } from "./proofing.service";
import { WhiteboardsController } from "./whiteboards.controller";
import { WhiteboardsService } from "./whiteboards.service";

/**
 * Module 12: Visual collaboration — task attachments (files/clips stored as
 * bytea, base64-JSON uploads), proofing annotations on files, whiteboards
 * and mind maps (jsonb documents, docs-like visibility). Db/Events are
 * @Global; Access gates by space, Audit records every mutation.
 */
@Module({
  imports: [AccessModule, AuditModule, LimitsModule],
  controllers: [
    FilesController,
    ProofingController,
    WhiteboardsController,
    MindmapsController,
  ],
  providers: [
    FilesService,
    ProofingService,
    WhiteboardsService,
    MindmapsService,
  ],
})
export class VisualModule {}
