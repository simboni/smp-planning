import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service";

/** Exposes the audit-trail writer to any feature module that mutates state. */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
