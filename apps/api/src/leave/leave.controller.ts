import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  AuthedRequest,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  WorkspaceGuard,
} from "../auth/guards";
import { LeaveService } from "./leave.service";

/**
 * Leave management (HR module). Members request and see their own leave;
 * admins and department heads decide; admins manage the policy (types).
 * Guests are outside the leave system entirely.
 */
@Controller("leave")
@UseGuards(JwtAuthGuard, WorkspaceGuard, RolesGuard)
@Roles("member")
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get("types")
  async listTypes(@Req() req: AuthedRequest) {
    return { types: await this.leave.listTypes(req.workspaceId!, req.userId!) };
  }

  @Post("types")
  @Roles("admin")
  async createType(
    @Req() req: AuthedRequest,
    @Body() body: { name?: string; daysPerYear?: number; color?: string },
  ) {
    return {
      type: await this.leave.createType(req.workspaceId!, req.userId!, body ?? {}),
    };
  }

  @Patch("types/:id")
  @Roles("admin")
  async updateType(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; daysPerYear?: number; color?: string },
  ) {
    await this.leave.updateType(req.workspaceId!, req.userId!, id, body ?? {});
    return { ok: true };
  }

  @Delete("types/:id")
  @Roles("admin")
  @HttpCode(204)
  async removeType(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.leave.removeType(req.workspaceId!, req.userId!, id);
  }

  @Get("requests")
  async listRequests(
    @Req() req: AuthedRequest,
    @Query("scope") scope?: string,
  ) {
    return {
      requests: await this.leave.listRequests(
        req.workspaceId!,
        req.userId!,
        req.role!,
        scope === "approvals" ? "approvals" : "mine",
      ),
    };
  }

  @Post("requests")
  async createRequest(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      leaveTypeId?: string;
      startDate?: string;
      endDate?: string;
      reason?: string;
    },
  ) {
    return {
      request: await this.leave.createRequest(
        req.workspaceId!,
        req.userId!,
        body ?? {},
      ),
    };
  }

  @Post("requests/:id/decide")
  async decide(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { approve?: boolean; note?: string },
  ) {
    await this.leave.decide(
      req.workspaceId!,
      req.userId!,
      req.role!,
      id,
      body ?? {},
    );
    return { ok: true };
  }

  @Post("requests/:id/cancel")
  async cancel(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.leave.cancel(req.workspaceId!, req.userId!, id);
    return { ok: true };
  }

  @Get("balances")
  async balances(@Req() req: AuthedRequest, @Query("year") year?: string) {
    const y = year ? Number(year) : new Date().getFullYear();
    return {
      balances: await this.leave.balances(req.workspaceId!, req.userId!, y),
    };
  }

  @Get("away")
  async away(
    @Req() req: AuthedRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    const inThirty = new Date(Date.now() + 30 * 86400_000)
      .toISOString()
      .slice(0, 10);
    return {
      requests: await this.leave.away(
        req.workspaceId!,
        req.userId!,
        from ?? today,
        to ?? inThirty,
      ),
    };
  }
}
