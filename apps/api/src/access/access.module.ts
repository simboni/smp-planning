import { Module } from "@nestjs/common";
import { AccessService } from "./access.service";

/**
 * Intra-workspace ACL (space visibility + permissions). DbModule is @Global,
 * so AccessService needs nothing imported; it is exported for any feature
 * module that reads or enforces sharing (hierarchy, sharing).
 */
@Module({
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
