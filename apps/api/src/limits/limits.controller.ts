import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { PLAN_IDS, PLANS, type PlanId } from "@stackup/shared";
import {
  AuthedRequest,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  WorkspaceGuard,
} from "../auth/guards";
import { LimitsService } from "./limits.service";

/**
 * Module 20/24 — usage against limits, plus the plan catalog and the
 * owner-gated plan switch (no payment processor yet; billing slots in front
 * of the select endpoint later).
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class LimitsController {
  constructor(private readonly limits: LimitsService) {}

  @Get("limits/usage")
  async usage(@Req() req: AuthedRequest) {
    return this.limits.usage(req.workspaceId!, req.userId!);
  }

  @Get("plans")
  async plans(@Req() req: AuthedRequest) {
    return {
      plans: PLAN_IDS.map((id) => PLANS[id]),
      current: await this.limits.currentPlan(req.workspaceId!, req.userId!),
    };
  }

  @Post("plans/select")
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles("owner")
  async select(@Req() req: AuthedRequest, @Body() body: { plan?: string }) {
    const plan = body?.plan as PlanId;
    if (!plan || !PLAN_IDS.includes(plan)) {
      throw new BadRequestException(
        `plan must be one of ${PLAN_IDS.join(", ")}`,
      );
    }
    return this.limits.selectPlan(req.workspaceId!, req.userId!, plan);
  }
}
