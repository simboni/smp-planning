import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { AuditModule } from "../audit/audit.module";
import { ViewsController } from "./views.controller";
import { ViewsService } from "./views.service";

/**
 * Module 5: Views Engine — saved views on Lists (list/board/calendar/table/
 * gantt lenses with a jsonb config). Gated per owning Space via AccessModule;
 * mutations recorded through AuditModule. DbModule is @Global.
 */
@Module({
  imports: [AuditModule, AccessModule],
  controllers: [ViewsController],
  providers: [ViewsService],
})
export class ViewsModule {}
