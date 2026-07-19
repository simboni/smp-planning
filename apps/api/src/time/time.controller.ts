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
import { TimeService } from "./time.service";

/**
 * Module 8: Time tracking, timesheets & workload. Every route is
 * workspace-scoped (JwtAuthGuard + WorkspaceGuard). Tracking permission
 * (space visible + >= edit) and entry ownership rules live in the service;
 * the admin-only timesheet review routes additionally require role >= admin
 * via RolesGuard + @Roles('admin').
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class TimeController {
  constructor(private readonly time: TimeService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  // --- Timer ----------------------------------------------------------------

  @Post("tasks/:id/timer/start")
  async startTimer(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) taskId: string,
    @Body() body: { note?: string; billable?: boolean },
  ) {
    return {
      entry: await this.time.startTimer(...this.ctx(req), taskId, body ?? {}),
    };
  }

  @Post("timer/stop")
  @HttpCode(200)
  async stopTimer(@Req() req: AuthedRequest) {
    return {
      entry: await this.time.stopTimer(req.workspaceId!, req.userId!),
    };
  }

  @Get("timer")
  async getTimer(@Req() req: AuthedRequest) {
    return {
      running: await this.time.getRunning(req.workspaceId!, req.userId!),
    };
  }

  // --- Entries --------------------------------------------------------------

  @Post("tasks/:id/time-entries")
  async createEntry(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) taskId: string,
    @Body()
    body: { startedAt?: string; endedAt?: string; billable?: boolean; note?: string },
  ) {
    return {
      entry: await this.time.createEntry(...this.ctx(req), taskId, body ?? {}),
    };
  }

  @Get("tasks/:id/time-entries")
  async listTaskEntries(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) taskId: string,
  ) {
    return this.time.listTaskEntries(...this.ctx(req), taskId);
  }

  @Patch("time-entries/:id")
  async updateEntry(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: { startedAt?: string; endedAt?: string; billable?: boolean; note?: string },
  ) {
    return {
      entry: await this.time.updateEntry(
        req.workspaceId!,
        req.userId!,
        id,
        body ?? {},
      ),
    };
  }

  @Delete("time-entries/:id")
  @HttpCode(204)
  async deleteEntry(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.time.deleteEntry(...this.ctx(req), id);
  }

  // --- Timesheets -----------------------------------------------------------

  @Get("timesheets/me")
  async myTimesheet(
    @Req() req: AuthedRequest,
    @Query("weekStart") weekStart?: string,
  ) {
    return this.time.myTimesheet(req.workspaceId!, req.userId!, weekStart);
  }

  @Post("timesheets/submit")
  async submitTimesheet(
    @Req() req: AuthedRequest,
    @Body() body: { weekStart?: string },
  ) {
    return {
      submission: await this.time.submitTimesheet(
        req.workspaceId!,
        req.userId!,
        body?.weekStart,
      ),
    };
  }

  @Get("timesheets")
  @UseGuards(RolesGuard)
  @Roles("admin")
  async listTimesheets(
    @Req() req: AuthedRequest,
    @Query("weekStart") weekStart?: string,
  ) {
    return this.time.listTimesheets(req.workspaceId!, req.userId!, weekStart);
  }

  @Post("timesheets/:userId/decide")
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles("admin")
  async decideTimesheet(
    @Req() req: AuthedRequest,
    @Param("userId", ParseUUIDPipe) targetUserId: string,
    @Body() body: { weekStart?: string; decision?: string },
  ) {
    return {
      submission: await this.time.decideTimesheet(
        req.workspaceId!,
        req.userId!,
        targetUserId,
        body ?? {},
      ),
    };
  }

  // --- Workload -------------------------------------------------------------

  @Get("workload")
  async workload(
    @Req() req: AuthedRequest,
    @Query("weekStart") weekStart?: string,
  ) {
    return this.time.workload(...this.ctx(req), weekStart);
  }
}
