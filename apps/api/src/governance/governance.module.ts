import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { LimitsModule } from "../limits/limits.module";
import { GovernanceController } from "./governance.controller";
import { GovernanceService } from "./governance.service";

/**
 * Module 17 — Governance: custom roles + audit log viewer. DbModule is
 * @Global; AuditModule provides the append-only audit writer. GovernanceService
 * is exported so other modules (e.g. Hierarchy) can enforce capabilities.
 */
@Module({
  imports: [AuditModule, LimitsModule],
  controllers: [GovernanceController],
  providers: [GovernanceService],
  exports: [GovernanceService],
})
export class GovernanceModule {}
