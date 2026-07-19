import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { AutomationsModule } from "../automations/automations.module";
import { ChecklistsService } from "./checklists.service";
import { FieldsService } from "./fields.service";
import { RelationsService } from "./relations.service";
import { StatusesService } from "./statuses.service";
import { TagsService } from "./tags.service";
import { TaskTypesService } from "./task-types.service";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

/**
 * Modules 3+4: Tasks Core (statuses, tags, tasks, subtasks, assignees,
 * watchers, checklists) plus M4's custom fields, dependencies/links, task
 * types and recurrence — all gated per owning Space via AccessModule, with
 * mutations recorded through AuditModule. DbModule is @Global. M11: task
 * mutations fire automation events through AutomationsModule's engine (the
 * engine acts via direct SQL, so no dependency cycle back into tasks).
 */
@Module({
  imports: [AuditModule, AccessModule, AutomationsModule],
  controllers: [TasksController],
  providers: [
    TasksService,
    StatusesService,
    TagsService,
    ChecklistsService,
    FieldsService,
    RelationsService,
    TaskTypesService,
  ],
})
export class TasksModule {}
