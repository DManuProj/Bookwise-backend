import { Global, Module } from '@nestjs/common';
import { NotificationController } from './notifications.controller.js';
import { NotificationService } from './notifications.service.js';

@Global()
@Module({
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
