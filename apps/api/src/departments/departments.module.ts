import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { HierarchyModule } from "../hierarchy/hierarchy.module";
import { TasksModule } from "../tasks/tasks.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DepartmentsController } from "./departments.controller";
import { DepartmentsService } from "./departments.service";

/**
 * Module HR: departments, designations and org onboarding. WorkspacesModule
 * supplies addMember so an email can be onboarded into the workspace and a
 * department in one step; HierarchyModule + TasksModule turn onboarding
 * checklists into real lists/tasks; AuditModule records every org change.
 */
@Module({
  imports: [AuditModule, WorkspacesModule, HierarchyModule, TasksModule],
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
