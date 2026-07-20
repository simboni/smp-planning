import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { LimitsModule } from "../limits/limits.module";
import { AutomationsController } from "./automations.controller";
import { AutomationsService } from "./automations.service";

/**
 * Module 11: Automations — per-space trigger/action rules plus the execution
 * engine. The engine lives in ITS OWN module (exported service) so
 * TasksModule can import it for the fire() hooks without a circular
 * dependency: AutomationsService performs actions as direct SQL and never
 * imports anything from tasks beyond the shared tasks.support helpers.
 * DbModule is @Global.
 */
@Module({
  imports: [AccessModule, AuditModule, LimitsModule],
  controllers: [AutomationsController],
  providers: [AutomationsService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
