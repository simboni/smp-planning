import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { FormsService } from "./forms.service";

/**
 * Module 11: the UNAUTHENTICATED public form surface — deliberately no
 * guards. Safety comes from the database, not the router: both handlers run
 * under db.withFormToken (only `app.form_token` is set), so RLS admits
 * exactly the one matching, active form row, and the submit path can only
 * create a task via the submit_form_task SECURITY DEFINER function. The
 * public shape never contains list/workspace ids.
 */
@Controller("public/forms")
export class PublicFormsController {
  constructor(private readonly forms: FormsService) {}

  @Get(":token")
  async getForm(@Param("token") token: string) {
    return { form: await this.forms.getPublicForm(token) };
  }

  @Post(":token/submit")
  @HttpCode(201)
  async submit(@Param("token") token: string, @Body() body: unknown) {
    await this.forms.submit(token, body);
    return { ok: true };
  }
}
