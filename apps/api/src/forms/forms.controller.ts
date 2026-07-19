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
import { FormsService } from "./forms.service";

/**
 * Module 11: Forms management (auth'd). No class-level role gate — access
 * rides on the target list's SPACE: managing a form requires edit permission
 * there, reading requires the space to be visible (enforced in the service).
 */
@Controller("forms")
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  private ctx(req: AuthedRequest) {
    return [req.workspaceId!, req.userId!, req.role!] as const;
  }

  @Get()
  async listForms(@Req() req: AuthedRequest) {
    return { forms: await this.forms.listForms(...this.ctx(req)) };
  }

  @Post()
  async createForm(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      name?: string;
      listId?: string;
      description?: string;
      fields?: unknown;
    },
  ) {
    return { form: await this.forms.createForm(...this.ctx(req), body ?? {}) };
  }

  @Get(":id")
  async getForm(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { form: await this.forms.getForm(...this.ctx(req), id) };
  }

  @Patch(":id")
  async updateForm(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      fields?: unknown;
      active?: boolean;
      listId?: string;
    },
  ) {
    return {
      form: await this.forms.updateForm(...this.ctx(req), id, body ?? {}),
    };
  }

  @Delete(":id")
  @HttpCode(204)
  async deleteForm(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.forms.deleteForm(...this.ctx(req), id);
  }

  @Post(":id/rotate-token")
  @HttpCode(200)
  async rotateToken(
    @Req() req: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { publicToken: await this.forms.rotateToken(...this.ctx(req), id) };
  }
}
