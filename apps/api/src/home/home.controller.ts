import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { HomeService } from "./home.service";

/**
 * Module 14: Home / My Work. Workspace-scoped; everything is computed for the
 * token's own user across their visible spaces. Guests are refused.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get("home")
  get(@Req() req: AuthedRequest) {
    return this.home.home(req.workspaceId!, req.userId!, req.role!);
  }

  /** At-a-glance counts (spaces, tasks, docs, goals, dashboards, members). */
  @Get("home/overview")
  overview(@Req() req: AuthedRequest) {
    return this.home.overview(req.workspaceId!, req.userId!, req.role!);
  }
}
