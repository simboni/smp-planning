import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { loadConfig } from "./config";
import { DbModule } from "./db/db.module";
import { HealthController } from "./health.controller";
import { WorkspacesModule } from "./workspaces/workspaces.module";

/**
 * JwtModule is registered global here so a single JwtService (bound to the
 * configured secret) is injectable across every feature module — auth signs
 * and every guard verifies with the same key. DbModule is @Global too, so
 * the one pool is shared process-wide.
 */
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: loadConfig().jwtSecret,
    }),
    DbModule,
    AuditModule,
    AuthModule,
    WorkspacesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
