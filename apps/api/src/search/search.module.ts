import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

/**
 * Module 14: universal search. AccessModule supplies visibleSpaceIds; DbModule
 * is @Global. Read-only, so no AuditModule.
 */
@Module({
  imports: [AccessModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
