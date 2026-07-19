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
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthedRequest, JwtAuthGuard, WorkspaceGuard } from "../auth/guards";
import { ProofingService } from "./proofing.service";

/**
 * Module 12: Proofing — 0..1-fraction pinned annotations on a file. Reading
 * follows file visibility; annotating needs >= 'comment' on the task's
 * space (enforced in the service, like task comments).
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class ProofingController {
  constructor(private readonly proofing: ProofingService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  @Get("files/:id/annotations")
  async listAnnotations(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) fileId: string,
  ) {
    return {
      annotations: await this.proofing.listAnnotations(
        ...this.ctx(req),
        fileId,
      ),
    };
  }

  @Post("files/:id/annotations")
  async createAnnotation(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) fileId: string,
    @Body() body: { x?: number; y?: number; body?: string },
  ) {
    return {
      annotation: await this.proofing.createAnnotation(
        ...this.ctx(req),
        fileId,
        body ?? {},
      ),
    };
  }

  @Patch("annotations/:id")
  async updateAnnotation(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { body?: string; resolved?: boolean },
  ) {
    return {
      annotation: await this.proofing.updateAnnotation(
        ...this.ctx(req),
        id,
        body ?? {},
      ),
    };
  }

  @Delete("annotations/:id")
  @HttpCode(204)
  async deleteAnnotation(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.proofing.deleteAnnotation(...this.ctx(req), id);
  }
}
