import { Module } from "@nestjs/common";
import { CommsModule } from "../comms/comms.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { GoogleOAuthClient } from "./google-oauth.client";
import { JwtAuthGuard, RolesGuard } from "./guards";

/**
 * JwtModule is registered globally in AppModule, so JwtService is injectable
 * here without re-importing it. AuthService is exported because
 * WorkspacesModule mints access tokens through it, keeping all token
 * issuance in one place. GoogleOAuthClient (M18) is a provider so tests can
 * override it with a fake profile source.
 */
@Module({
  imports: [CommsModule],
  controllers: [AuthController],
  providers: [AuthService, GoogleOAuthClient, JwtAuthGuard, RolesGuard],
  exports: [AuthService],
})
export class AuthModule {}
