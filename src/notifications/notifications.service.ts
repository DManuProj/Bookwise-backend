import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ServicesService } from '../services/services.service.js';
import { AuthenticatedUser } from '../common/types/index.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  //GET all notifications
  async getAllNotifications(user: AuthenticatedUser) {
    const notifications = await this.prisma.db.notification.findMany({
      where: { userId: user.id, orgId: user.orgId!, isRead: false },
      orderBy: { createdAt: 'desc' },
    });

    this.logger.log(`get all notification for ${user.email} `);

    return { success: true, data: notifications };
  }

  //PUT mark as read
  async markOneAsRead(user: AuthenticatedUser, id: string) {
    const notification = await this.prisma.db.notification.findUnique({
      where: { id },
    });
    if (!notification || notification.userId !== user.id)
      throw new NotFoundException('Notifications not found');

    await this.prisma.db.notification.update({
      where: { id },
      data: {
        isRead: true,
      },
    });

    this.logger.log(`mark as read notification ${notification.id} `);

    return { success: true, message: 'Notification marked as read' };
  }

  //PUT mark as read
  async markAllAsRead(user: AuthenticatedUser) {
    await this.prisma.db.notification.updateMany({
      where: { userId: user.id, orgId: user.orgId!, isRead: false },
      data: {
        isRead: true,
      },
    });

    this.logger.log(`mark as all read notifications ${user.id} `);

    return { success: true, message: 'All notifications marked as read' };
  }

  // Helper — create a notification (called by other services)
  async createNotification(
    userId: string,
    orgId: string,
    title: string,
    message: string,
    type: string,
    entityType?: string,
    entityId?: string,
  ) {
    await this.prisma.db.notification.create({
      data: {
        title,
        message,
        type,
        entityType: entityType || null,
        entityId: entityId || null,
        userId,
        orgId,
      },
    });
  }

  // ── Helper: notify users by specific roles ────────────
  async notifyByRoles(
    orgId: string,
    roles: Role[],
    title: string,
    message: string,
    type: string,
    entityType?: string,
    entityId?: string,
  ) {
    const users = await this.prisma.db.user.findMany({
      where: {
        orgId,
        role: { in: roles },
        status: 'ACTIVE',
      },
    });

    for (const user of users) {
      await this.createNotification(
        user.id,
        orgId,
        title,
        message,
        type,
        entityType,
        entityId,
      );
    }
  }

  // ── Helper: shortcut for notifying owner + admin ──────
  async notifyOrgAdmins(
    orgId: string,
    title: string,
    message: string,
    type: string,
    entityType?: string,
    entityId?: string,
  ) {
    await this.notifyByRoles(
      orgId,
      ['OWNER', 'ADMIN'],
      title,
      message,
      type,
      entityType,
      entityId,
    );
  }
}
