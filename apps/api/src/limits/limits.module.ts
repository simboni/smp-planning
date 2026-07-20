import { Module } from "@nestjs/common";
import { LimitsController } from "./limits.controller";
import { LimitsService } from "./limits.service";

/**
 * Module 20 — limits & metering. DbModule is @Global. LimitsService is
 * exported so Visual (attachments) and Automations can enforce caps at their
 * write points.
 */
@Module({
  controllers: [LimitsController],
  providers: [LimitsService],
  exports: [LimitsService],
})
export class LimitsModule {}
