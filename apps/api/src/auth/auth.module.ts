import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard, RolesGuard } from "./guards";

/**
 * JwtModule is registered globally in AppModule, so JwtService is injectable
 * here without re-importing it. AuthService is exported because
 * WorkspacesModule mints access tokens through it, keeping all token
 * issuance in one place.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService],
})
export class AuthModule {}
