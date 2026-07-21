import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import { AppThrottlerGuard } from "./common/throttler.guard";
import { AccessModule } from "./access/access.module";
import { AiModule } from "./ai/ai.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { AutomationsModule } from "./automations/automations.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { ChatModule } from "./chat/chat.module";
import { CommentsModule } from "./comments/comments.module";
import { CommsModule } from "./comms/comms.module";
import { loadConfig } from "./config";
import { DashboardsModule } from "./dashboards/dashboards.module";
import { DbModule } from "./db/db.module";
import { DocsModule } from "./docs/docs.module";
import { EventsModule } from "./events/events.module";
import { FormsModule } from "./forms/forms.module";
import { GoalsModule } from "./goals/goals.module";
import { GovernanceModule } from "./governance/governance.module";
import { HealthController } from "./health.controller";
import { HierarchyModule } from "./hierarchy/hierarchy.module";
import { HomeModule } from "./home/home.module";
import { InboxModule } from "./inbox/inbox.module";
import { LimitsModule } from "./limits/limits.module";
import { PushModule } from "./push/push.module";
import { SearchModule } from "./search/search.module";
import { SharesModule } from "./shares/shares.module";
import { SharingModule } from "./sharing/sharing.module";
import { SprintsModule } from "./sprints/sprints.module";
import { TasksModule } from "./tasks/tasks.module";
import { TemplatesModule } from "./templates/templates.module";
import { VisualModule } from "./visual/visual.module";
import { TeamsModule } from "./teams/teams.module";
import { TimeModule } from "./time/time.module";
import { ViewsModule } from "./views/views.module";
import { WorkspaceExtrasModule } from "./workspace-extras/workspace-extras.module";
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
      signOptions: { algorithm: "HS256" },
    }),
    // Baseline abuse protection: a generous per-IP-per-route ceiling on every
    // endpoint (auth routes tighten this further with @Throttle). Disabled in
    // tests by AppThrottlerGuard. TTL is milliseconds in throttler v6.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DbModule,
    EventsModule,
    AuditModule,
    AccessModule,
    AuthModule,
    WorkspacesModule,
    GovernanceModule,
    HierarchyModule,
    TeamsModule,
    SharingModule,
    TasksModule,
    ViewsModule,
    CommentsModule,
    InboxModule,
    DocsModule,
    TimeModule,
    GoalsModule,
    DashboardsModule,
    SprintsModule,
    FormsModule,
    AutomationsModule,
    VisualModule,
    ChatModule,
    SearchModule,
    HomeModule,
    TemplatesModule,
    WorkspaceExtrasModule,
    AiModule,
    IntegrationsModule,
    LimitsModule,
    CommsModule,
    PushModule,
    SharesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
