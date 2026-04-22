import { Controller, Get, Logger, Param, Put, UseGuards } from '@nestjs/common';
import { ClerkAuthGurad } from '../auth/auth.guard.js';
import { OrgGuard } from '../common/guards/org.guard.js';
import { NotificationService } from './notifications.service.js';
import { CurrentUser } from '../auth/auth.decorator.js';
import type { AuthenticatedUser } from '../common/types/index.js';

@Controller('notifications')
@UseGuards(ClerkAuthGurad, OrgGuard)
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly notificationService: NotificationService) {}

  //GET /api/notifications
  @Get()
  async getAllNotifications(@CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`Fetching notifications for: ${user.email}`);
    return await this.notificationService.getAllNotifications(user);
  }

  //PUT  /api/notifications/:id/read
  @Put(':id/read')
  async markOneAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    this.logger.log(`mark as read notification for: ${user.email}`);
    return await this.notificationService.markOneAsRead(user, id);
  }

  // PUT  /api/notifications/read-all
  @Put('real-all')
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`mark as read ALL notificationS for: ${user.email}`);
    return await this.notificationService.markAllAsRead(user);
  }
}
