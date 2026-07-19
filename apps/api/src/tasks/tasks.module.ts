import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { ChecklistsService } from "./checklists.service";
import { StatusesService } from "./statuses.service";
import { TagsService } from "./tags.service";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

/**
 * Module 3: Tasks Core. Statuses, tags, tasks (with subtasks, assignees,
 * watchers, checklists) — all gated per owning Space via AccessModule, with
 * mutations recorded through AuditModule. DbModule is @Global.
 */
@Module({
  imports: [AuditModule, AccessModule],
  controllers: [TasksController],
  providers: [TasksService, StatusesService, TagsService, ChecklistsService],
})
export class TasksModule {}
