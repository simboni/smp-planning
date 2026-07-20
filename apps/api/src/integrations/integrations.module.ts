import { Module } from "@nestjs/common";
import { HierarchyModule } from "../hierarchy/hierarchy.module";
import { TasksModule } from "../tasks/tasks.module";
import { ApiTokensController } from "./api-tokens.controller";
import { ImportExportController } from "./import-export.controller";
import { ImportExportService } from "./import-export.service";
import { PatGuard } from "./pat.guard";
import { PatService } from "./pat.service";
import { PublicApiController } from "./public-api.controller";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";

/**
 * Module 15 — Integrations: Personal Access Tokens + the public REST API v1,
 * outbound webhooks (tapping the global event bus), and import/export. Reuses
 * HierarchyService and TasksService so the public/import paths inherit every
 * RLS, permission and audit guarantee of the interactive app.
 */
@Module({
  imports: [HierarchyModule, TasksModule],
  controllers: [
    ApiTokensController,
    PublicApiController,
    WebhooksController,
    ImportExportController,
  ],
  providers: [PatService, PatGuard, WebhooksService, ImportExportService],
})
export class IntegrationsModule {}
