import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { LimitsService } from "./limits.service";

/** Module 20 — read the workspace's current usage against its limits. */
@Controller("limits")
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class LimitsController {
  constructor(private readonly limits: LimitsService) {}

  @Get("usage")
  async usage(@Req() req: AuthedRequest) {
    return this.limits.usage(req.workspaceId!, req.userId!);
  }
}
