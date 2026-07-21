import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { GoalsModule } from "../goals/goals.module";
import { LimitsModule } from "../limits/limits.module";
import { DashboardsController } from "./dashboards.controller";
import { DashboardsService } from "./dashboards.service";

/**
 * Module 10: Dashboards — workspace-wide dashboards holding positioned cards
 * whose data (status/priority breakdowns, assignee load, tracked time, goal
 * progress, sprint burndown, recent activity) is computed at read time per
 * CALLER visibility (AccessModule). GoalsModule is imported so the
 * goalProgress card reuses GoalsService's exact progress math; sprint math is
 * shared via sprints/sprints.support.ts.
 */
@Module({
  imports: [AccessModule, AuditModule, GoalsModule, LimitsModule],
  controllers: [DashboardsController],
  providers: [DashboardsService],
})
export class DashboardsModule {}
