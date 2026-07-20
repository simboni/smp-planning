import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { ImportExportService } from "./import-export.service";

/**
 * Import / Export endpoints (M15). Session-authenticated. CSV export sets a
 * text/csv content type; JSON export returns the visible hierarchy.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class ImportExportController {
  constructor(private readonly svc: ImportExportService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  @Get("export/workspace")
  async exportWorkspace(@Req() req: AuthedRequest) {
    return this.svc.exportWorkspace(req.workspaceId!, req.userId!, req.role!);
  }

  @Get("lists/:id/export.csv")
  @Header("content-type", "text/csv; charset=utf-8")
  @Header("content-disposition", 'attachment; filename="tasks.csv"')
  async exportCsv(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.svc.exportListCsv(req.workspaceId!, req.userId!, req.role!, id);
  }

  @Post("import/csv")
  async importCsv(
    @Req() req: AuthedRequest,
    @Body() body: { listId?: string; csv?: string },
  ) {
    if (!body.listId || !body.csv) {
      throw new BadRequestException("listId and csv are required");
    }
    return this.svc.importCsv(this.ctx(req), body.listId, body.csv);
  }

  @Post("import/board")
  async importBoard(
    @Req() req: AuthedRequest,
    @Body() body: { source?: string; data?: unknown },
  ) {
    if (!body.data) throw new BadRequestException("data is required");
    return this.svc.importBoard(
      this.ctx(req),
      body.source ?? "native",
      body.data,
    );
  }
}
