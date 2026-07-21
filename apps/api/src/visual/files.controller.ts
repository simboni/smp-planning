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

/** Image content types safe to serve inline (raster only — no SVG). */
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
]);

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

  /**
   * The raw file bytes. Images are served inline (so <img src> previews work);
   * everything else is forced to `attachment` so an active type (HTML, SVG)
   * can never be rendered same-origin as a document — closing a stored-XSS
   * path even if a client is ever tricked into a top-level navigation here.
   * X-Content-Type-Options: nosniff (set globally) stops MIME-sniffing.
   */
  @Get("files/:id")
  async getRaw(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const file = await this.files.getRaw(...this.ctx(req), id);
    // Keep the filename header-safe: strip quotes/control/non-ascii chars.
    const safeName = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    // Only a fixed set of image types may render inline; treat everything else
    // (incl. image/svg+xml, which can carry script) as a download.
    const inlineOk = INLINE_IMAGE_TYPES.has(file.mime.toLowerCase());
    const disposition = inlineOk ? "inline" : "attachment";
    res.setHeader("Content-Type", inlineOk ? file.mime : "application/octet-stream");
    res.setHeader("Content-Disposition", `${disposition}; filename="${safeName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
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
