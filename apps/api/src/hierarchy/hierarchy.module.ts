import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { HierarchyController } from "./hierarchy.controller";
import { HierarchyService } from "./hierarchy.service";

/**
 * Module 1: the Spaces -> Folders -> Lists hierarchy. DbModule is @Global,
 * so only AuditModule needs importing here for the audit-trail writer.
 */
@Module({
  imports: [AuditModule],
  controllers: [HierarchyController],
  providers: [HierarchyService],
})
export class HierarchyModule {}
