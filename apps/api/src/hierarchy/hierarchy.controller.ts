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
import {
  AuthedRequest,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  WorkspaceGuard,
} from "../auth/guards";
import { HierarchyService } from "./hierarchy.service";

/**
 * The Spaces -> Folders -> Lists hierarchy (Module 1). Every route is
 * workspace-scoped (JwtAuthGuard + WorkspaceGuard); reads are open to any
 * member (incl. guest), writes require role >= member via RolesGuard +
 * @Roles('member'). workspaceId/userId always come from the access token.
 */
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class HierarchyController {
  constructor(private readonly hierarchy: HierarchyService) {}

  // --- Reads ----------------------------------------------------------------

  @Get("hierarchy")
  async tree(@Req() req: AuthedRequest) {
    return this.hierarchy.tree(req.workspaceId!, req.userId!, req.role!);
  }

  @Get("spaces")
  async listSpaces(@Req() req: AuthedRequest) {
    return {
      spaces: await this.hierarchy.listSpaces(
        req.workspaceId!,
        req.userId!,
        req.role!,
      ),
    };
  }

  @Get("spaces/:id")
  async spaceDetail(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.hierarchy.spaceDetail(
      req.workspaceId!,
      req.userId!,
      req.role!,
      id,
    );
  }

  @Get("lists/:id")
  async listDetail(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.hierarchy.listDetail(
      req.workspaceId!,
      req.userId!,
      req.role!,
      id,
    );
  }

  // --- Space writes ---------------------------------------------------------

  @Post("spaces")
  @UseGuards(RolesGuard)
  @Roles("member")
  async createSpace(
    @Req() req: AuthedRequest,
    @Body()
    body: { name?: string; color?: string; icon?: string; isPrivate?: boolean },
  ) {
    return {
      space: await this.hierarchy.createSpace(
        req.workspaceId!,
        req.userId!,
        req.role!,
        body ?? {},
      ),
    };
  }

  @Patch("spaces/:id")
  @UseGuards(RolesGuard)
  @Roles("member")
  async updateSpace(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      color?: string;
      icon?: string | null;
      isPrivate?: boolean;
      archived?: boolean;
    },
  ) {
    return {
      space: await this.hierarchy.updateSpace(
        req.workspaceId!,
        req.userId!,
        req.role!,
        id,
        body ?? {},
      ),
    };
  }

  @Delete("spaces/:id")
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @Roles("member")
  async deleteSpace(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.hierarchy.deleteSpace(
      req.workspaceId!,
      req.userId!,
      req.role!,
      id,
    );
  }

  @Post("spaces/reorder")
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles("member")
  async reorderSpaces(
    @Req() req: AuthedRequest,
    @Body() body: { ids?: string[] },
  ) {
    await this.hierarchy.reorderSpaces(
      req.workspaceId!,
      req.userId!,
      req.role!,
      body?.ids ?? [],
    );
    return { ok: true };
  }

  // --- Folder writes --------------------------------------------------------

  @Post("spaces/:id/folders")
  @UseGuards(RolesGuard)
  @Roles("member")
  async createFolder(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
    @Body() body: { name?: string },
  ) {
    return {
      folder: await this.hierarchy.createFolder(
        req.workspaceId!,
        req.userId!,
        req.role!,
        spaceId,
        body ?? {},
      ),
    };
  }

  @Patch("folders/:id")
  @UseGuards(RolesGuard)
  @Roles("member")
  async updateFolder(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; archived?: boolean; spaceId?: string },
  ) {
    return {
      folder: await this.hierarchy.updateFolder(
        req.workspaceId!,
        req.userId!,
        req.role!,
        id,
        body ?? {},
      ),
    };
  }

  @Delete("folders/:id")
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @Roles("member")
  async deleteFolder(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.hierarchy.deleteFolder(
      req.workspaceId!,
      req.userId!,
      req.role!,
      id,
    );
  }

  @Post("folders/reorder")
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles("member")
  async reorderFolders(
    @Req() req: AuthedRequest,
    @Body() body: { spaceId?: string; ids?: string[] },
  ) {
    await this.hierarchy.reorderFolders(
      req.workspaceId!,
      req.userId!,
      req.role!,
      body?.spaceId ?? "",
      body?.ids ?? [],
    );
    return { ok: true };
  }

  // --- List writes ----------------------------------------------------------

  @Post("spaces/:id/lists")
  @UseGuards(RolesGuard)
  @Roles("member")
  async createList(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) spaceId: string,
    @Body() body: { name?: string; folderId?: string | null; color?: string },
  ) {
    return {
      list: await this.hierarchy.createList(
        req.workspaceId!,
        req.userId!,
        req.role!,
        spaceId,
        body ?? {},
      ),
    };
  }

  @Patch("lists/:id")
  @UseGuards(RolesGuard)
  @Roles("member")
  async updateList(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      color?: string | null;
      archived?: boolean;
      folderId?: string | null;
      spaceId?: string;
    },
  ) {
    return {
      list: await this.hierarchy.updateList(
        req.workspaceId!,
        req.userId!,
        req.role!,
        id,
        body ?? {},
      ),
    };
  }

  @Delete("lists/:id")
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @Roles("member")
  async deleteList(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.hierarchy.deleteList(
      req.workspaceId!,
      req.userId!,
      req.role!,
      id,
    );
  }

  @Post("lists/reorder")
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles("member")
  async reorderLists(
    @Req() req: AuthedRequest,
    @Body() body: { spaceId?: string; folderId?: string | null; ids?: string[] },
  ) {
    await this.hierarchy.reorderLists(
      req.workspaceId!,
      req.userId!,
      req.role!,
      body?.spaceId ?? "",
      body?.folderId ?? null,
      body?.ids ?? [],
    );
    return { ok: true };
  }
}
