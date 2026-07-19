import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AccessModule } from "./access/access.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { CommentsModule } from "./comments/comments.module";
import { loadConfig } from "./config";
import { DbModule } from "./db/db.module";
import { EventsModule } from "./events/events.module";
import { HealthController } from "./health.controller";
import { HierarchyModule } from "./hierarchy/hierarchy.module";
import { InboxModule } from "./inbox/inbox.module";
import { SharingModule } from "./sharing/sharing.module";
import { TasksModule } from "./tasks/tasks.module";
import { TeamsModule } from "./teams/teams.module";
import { ViewsModule } from "./views/views.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

/**
 * JwtModule is registered global here so a single JwtService (bound to the
 * configured secret) is injectable across every feature module — auth signs
 * and every guard verifies with the same key. DbModule is @Global too, so
 * the one pool is shared process-wide.
 */
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: loadConfig().jwtSecret,
    }),
    DbModule,
    EventsModule,
    AuditModule,
    AccessModule,
    AuthModule,
    WorkspacesModule,
    HierarchyModule,
    TeamsModule,
    SharingModule,
    TasksModule,
    ViewsModule,
    CommentsModule,
    InboxModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
