import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { FormsController } from "./forms.controller";
import { FormsService } from "./forms.service";
import { PublicFormsController } from "./public-forms.controller";

/**
 * Module 11: Forms — public intake forms targeting a List. Management is
 * auth'd and gated on the list's space (AccessModule); the public
 * fill/submit controller is unauthenticated and confined by the
 * app.form_token RLS context + submit_form_task SECURITY DEFINER function.
 * DbModule is @Global.
 */
@Module({
  imports: [AccessModule, AuditModule],
  controllers: [FormsController, PublicFormsController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
