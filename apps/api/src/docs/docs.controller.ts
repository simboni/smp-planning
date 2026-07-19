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
import { DocsService } from "./docs.service";

/**
 * Module 7: Docs, wikis & Notepad. Workspace-scoped (JwtAuthGuard +
 * WorkspaceGuard); the doc visibility/editability rules (space-attached vs
 * unattached, private-to-creator, guest exclusion) live in the service —
 * an invisible doc is always a 404, a read-only one a 403.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class DocsController {
  constructor(private readonly docs: DocsService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  // --- docs -----------------------------------------------------------------

  @Get("docs")
  async listDocs(@Req() req: AuthedRequest) {
    return { docs: await this.docs.listDocs(...this.ctx(req)) };
  }

  @Post("docs")
  async createDoc(
    @Req() req: AuthedRequest,
    @Body()
    body: { name?: string; icon?: string; spaceId?: string; isPrivate?: boolean },
  ) {
    return { doc: await this.docs.createDoc(...this.ctx(req), body ?? {}) };
  }

  @Get("docs/:id")
  async getDoc(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.docs.getDoc(...this.ctx(req), id);
  }

  @Patch("docs/:id")
  async updateDoc(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      icon?: string;
      spaceId?: string | null;
      isPrivate?: boolean;
    },
  ) {
    return { doc: await this.docs.updateDoc(...this.ctx(req), id, body ?? {}) };
  }

  @Delete("docs/:id")
  @HttpCode(204)
  async deleteDoc(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.docs.removeDoc(...this.ctx(req), id);
  }

  // --- pages ----------------------------------------------------------------

  @Get("pages/:id")
  async getPage(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { page: await this.docs.getPage(...this.ctx(req), id) };
  }

  @Post("docs/:id/pages")
  async createPage(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) docId: string,
    @Body() body: { title?: string; parentPageId?: string },
  ) {
    return {
      page: await this.docs.createPage(...this.ctx(req), docId, body ?? {}),
    };
  }

  @Patch("pages/:id")
  async updatePage(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      title?: string;
      content?: string;
      parentPageId?: string | null;
      position?: number;
    },
  ) {
    return {
      page: await this.docs.updatePage(...this.ctx(req), id, body ?? {}),
    };
  }

  @Delete("pages/:id")
  @HttpCode(204)
  async deletePage(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.docs.removePage(...this.ctx(req), id);
  }

  // --- notepad (strictly the caller's own notes) ----------------------------

  @Get("notes")
  async listNotes(@Req() req: AuthedRequest) {
    return {
      notes: await this.docs.listNotes(req.workspaceId!, req.userId!),
    };
  }

  @Post("notes")
  async createNote(
    @Req() req: AuthedRequest,
    @Body() body: { content?: string },
  ) {
    return {
      note: await this.docs.createNote(req.workspaceId!, req.userId!, body ?? {}),
    };
  }

  @Patch("notes/:id")
  async updateNote(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { content?: string },
  ) {
    return {
      note: await this.docs.updateNote(
        req.workspaceId!,
        req.userId!,
        id,
        body ?? {},
      ),
    };
  }

  @Delete("notes/:id")
  @HttpCode(204)
  async deleteNote(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.docs.removeNote(req.workspaceId!, req.userId!, id);
  }
}
