import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TeamsController } from "./teams.controller";
import { TeamsService } from "./teams.service";

/**
 * Teams (user groups). DbModule is @Global; AuditModule provides the audit
 * writer for team lifecycle events.
 */
@Module({
  imports: [AuditModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
