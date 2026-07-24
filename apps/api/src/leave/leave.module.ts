import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { LeaveController } from "./leave.controller";
import { LeaveService } from "./leave.service";

/**
 * Module HR: leave management. Approval routing rides on the departments
 * module's data (department heads decide their members' requests) but only
 * via SQL — no service dependency needed.
 */
@Module({
  imports: [AuditModule],
  controllers: [LeaveController],
  providers: [LeaveService],
  exports: [LeaveService],
})
export class LeaveModule {}
