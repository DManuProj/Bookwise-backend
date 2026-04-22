import { Module } from '@nestjs/common';
import { NotificationController } from './notifications.controller.js';
import { NotificationService } from './notifications.service.js';

@Module({
  controllers: [NotificationController],
  providers: [NotificationService],
})
export class NotificationModule {}
