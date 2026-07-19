import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { FilesService } from "./files.service";

/**
 * Module 12: task attachments. Uploads arrive as base64 JSON (the JSON body
 * limit is raised to 8MB in main.ts to fit the 5MB decoded cap); downloads
 * stream the raw bytea with the file's own content type.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  @Post("tasks/:id/files")
  async upload(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) taskId: string,
    @Body()
    body: { name?: string; mime?: string; dataBase64?: string; isClip?: boolean },
  ) {
    return {
      file: await this.files.upload(...this.ctx(req), taskId, body ?? {}),
    };
  }

  @Get("tasks/:id/files")
  async listTaskFiles(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) taskId: string,
  ) {
    return { files: await this.files.listTaskFiles(...this.ctx(req), taskId) };
  }

  /** The raw file bytes, served inline with its stored content type. */
  @Get("files/:id")
  async getRaw(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const file = await this.files.getRaw(...this.ctx(req), id);
    // Keep the filename header-safe: strip quotes/control/non-ascii chars.
    const safeName = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(file.data);
  }

  @Delete("files/:id")
  @HttpCode(204)
  async deleteFile(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.files.deleteFile(...this.ctx(req), id);
  }
}
