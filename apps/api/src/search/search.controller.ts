import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { SearchService } from "./search.service";

/**
 * Module 14: universal search. Workspace-scoped; the service confines every
 * group to the caller's visible spaces and refuses guests.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get("search")
  run(
    @Req() req: AuthedRequest,
    @Query("q") q?: string,
    @Query("limit") limit?: string,
  ) {
    return this.search.search(
      req.workspaceId!,
      req.userId!,
      req.role!,
      q,
      limit !== undefined ? Number(limit) : undefined,
    );
  }
}
