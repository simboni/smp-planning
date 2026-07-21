import { Module } from "@nestjs/common";
import { DashboardsModule } from "../dashboards/dashboards.module";
import { DocsModule } from "../docs/docs.module";
import { HierarchyModule } from "../hierarchy/hierarchy.module";
import { TasksModule } from "../tasks/tasks.module";
import { PublicShareController } from "./public-share.controller";
import { SharesController } from "./shares.controller";
import { SharesService } from "./shares.service";

/**
 * Module 26: public share links. Reuses the tasks/docs/dashboards/hierarchy
 * read services so a shared entity is loaded exactly as the sharer sees it.
 */
@Module({
  imports: [TasksModule, DocsModule, DashboardsModule, HierarchyModule],
  controllers: [SharesController, PublicShareController],
  providers: [SharesService],
})
export class SharesModule {}
