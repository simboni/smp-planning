import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { TimeController } from "./time.controller";
import { TimeService } from "./time.service";

/**
 * Module 8: Time tracking, timesheets & workload — timer + manual time
 * entries per task (space-edit gated via AccessModule), Monday-start
 * timesheet submissions with admin approval, and the per-member workload
 * week view. Mutations audit via AuditModule; DbModule and EventsModule are
 * @Global so the service injects them freely.
 */
@Module({
  imports: [AccessModule, AuditModule],
  controllers: [TimeController],
  providers: [TimeService],
})
export class TimeModule {}
