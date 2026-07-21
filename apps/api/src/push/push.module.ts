import { Module } from "@nestjs/common";
import { FcmClient } from "./fcm.client";
import { PushController } from "./push.controller";
import { PushService } from "./push.service";

/**
 * Mobile push notifications (FCM). Ships dormant: everything is wired, but
 * FcmClient only sends once the FCM_SERVICE_ACCOUNT env is configured.
 * PushService/FcmClient are exported so notification producers can push and
 * tests can override the network seam. DbModule is @Global.
 */
@Module({
  controllers: [PushController],
  providers: [PushService, FcmClient],
  exports: [PushService],
})
export class PushModule {}
