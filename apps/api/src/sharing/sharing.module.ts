import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { SharingController } from "./sharing.controller";
import { SharingService } from "./sharing.service";

/**
 * Space-level sharing (privacy toggle + share grants). DbModule is @Global;
 * AuditModule provides the audit writer, AccessModule the ACL checks.
 */
@Module({
  imports: [AuditModule, AccessModule],
  controllers: [SharingController],
  providers: [SharingService],
})
export class SharingModule {}
