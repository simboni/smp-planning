import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { GovernanceModule } from "../governance/governance.module";
import { HierarchyController } from "./hierarchy.controller";
import { HierarchyService } from "./hierarchy.service";

/**
 * Module 1: the Spaces -> Folders -> Lists hierarchy, now visibility- and
 * permission-aware via AccessModule (M2). DbModule is @Global; AuditModule
 * provides the audit writer, AccessModule the intra-workspace ACL,
 * GovernanceModule the capability checks (M17, e.g. createSpaces).
 */
@Module({
  imports: [AuditModule, AccessModule, GovernanceModule],
  controllers: [HierarchyController],
  providers: [HierarchyService],
  // M15 public REST API reuses listSpaces / createList etc.
  exports: [HierarchyService],
})
export class HierarchyModule {}
