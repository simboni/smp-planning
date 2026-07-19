import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { WorkspaceExtrasController } from "./workspace-extras.controller";
import { WorkspaceExtrasService } from "./workspace-extras.service";

/**
 * Module 14: ClickApps (per-space feature toggles) + Favorites (per-user
 * stars). AccessModule gates space visibility/edit and supplies
 * visibleSpaceIds for favorite resolution. DbModule is @Global.
 */
@Module({
  imports: [AccessModule],
  controllers: [WorkspaceExtrasController],
  providers: [WorkspaceExtrasService],
})
export class WorkspaceExtrasModule {}
