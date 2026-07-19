import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { GoalsController } from "./goals.controller";
import { GoalsService } from "./goals.service";

/**
 * Module 9: Goals (OKRs) & Portfolios — workspace-wide goal folders, goals
 * with typed targets (number/currency/boolean/tasks) whose progress the API
 * computes, and portfolios rolling Lists up into per-list task stats.
 * AccessModule supplies space visibility (linkable tasks/lists, private-task
 * masking); mutations audit via AuditModule; DbModule and EventsModule are
 * @Global so the service injects them freely.
 */
@Module({
  imports: [AccessModule, AuditModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  // Exported so the M10 dashboards goalProgress card reuses the exact
  // progress math instead of duplicating the aggregate query.
  exports: [GoalsService],
})
export class GoalsModule {}
