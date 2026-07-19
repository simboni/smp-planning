import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { SprintsController } from "./sprints.controller";
import { SprintsService } from "./sprints.service";

/**
 * Module 10: Sprints — a sprint wraps a List 1:1 with a date window; story
 * points live on tasks (tasks.sprint_points). Space edit permission gates
 * management (AccessModule); mutations audit via AuditModule; DbModule and
 * EventsModule are @Global. SprintsService is exported so the dashboards
 * sprintBurndown card shares the same math.
 */
@Module({
  imports: [AccessModule, AuditModule],
  controllers: [SprintsController],
  providers: [SprintsService],
  exports: [SprintsService],
})
export class SprintsModule {}
