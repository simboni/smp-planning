import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { TasksModule } from "../tasks/tasks.module";
import { TemplatesController } from "./templates.controller";
import { TemplatesService } from "./templates.service";

/**
 * Module 14: Templates (serialize task/list/doc/space -> jsonb, re-instantiate
 * under fresh ids). AccessModule gates source/target by space; TasksModule
 * exports StatusesService for default-status provisioning on apply; AuditModule
 * records template.created/applied/deleted. DbModule is @Global.
 */
@Module({
  imports: [AccessModule, AuditModule, TasksModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
