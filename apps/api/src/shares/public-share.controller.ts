import { Controller, Get, Param } from "@nestjs/common";
import { SharesService } from "./shares.service";

/**
 * Module 26 — the UNAUTHENTICATED public read surface. No guards: a valid
 * share token is the only credential. The service resolves it under the
 * fail-closed `app.share_token` RLS context and returns a read-only view.
 */
@Controller("public/share")
export class PublicShareController {
  constructor(private readonly shares: SharesService) {}

  @Get(":token")
  async resolve(@Param("token") token: string) {
    return { view: await this.shares.resolve(token) };
  }
}
