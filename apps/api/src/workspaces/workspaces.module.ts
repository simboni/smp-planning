import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { LimitsModule } from "../limits/limits.module";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

/** AuthModule is imported for AuthService (token minting + workspace listing). */
@Module({
  imports: [AuthModule, AuditModule, LimitsModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
})
export class WorkspacesModule {}
