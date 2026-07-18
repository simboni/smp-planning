import { Global, Module } from "@nestjs/common";
import { DbService } from "./db.service";

/**
 * Global so the single pooled DbService is injectable everywhere without
 * each feature module re-importing it — there is exactly one pool per
 * process.
 */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
