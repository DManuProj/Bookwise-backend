import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../generated/prisma/prisma.service.js';
import { AcceptInvitationDto } from './invitations.dto.js';
import { NotificationService } from '../notifications/notifications.service.js';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  //GET - fetch invitation details
  async getInvitation(token: string) {
    const invitation = await this.prisma.db.staffInvitation.findUnique({
      where: { token },
      include: { org: true }, // need org name for display
    });

    if (!invitation) throw new NotFoundException('Invalid invitation link');

    // Check if expired — update status on read
    if (invitation.status !== 'ACCEPTED' && invitation.expiresAt < new Date()) {
      await this.prisma.db.staffInvitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });

      return {
        success: true,
        data: {
          status: 'EXPIRED',
          orgName: invitation.org.name,
        },
      };
    }

    return {
      success: true,
      data: {
        name: invitation.name,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        orgName: invitation.org.name,
        orgLogo: invitation.org.logo,
        expiresAt: invitation.expiresAt,
      },
    };
  }

  // POST — accept invitation
  async acceptInvitation(token: string, data: AcceptInvitationDto) {
    const invitation = await this.prisma.db.staffInvitation.findUnique({
      where: { token },
    });

    if (!invitation) throw new NotFoundException('Invalid invitation link');

    if (invitation.status === 'ACCEPTED') {
      throw new BadRequestException('Invitation already accepted');
    }

    if (invitation.expiresAt < new Date()) {
      await this.prisma.db.staffInvitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('Invitation has expired');
    }

    await this.prisma.db.$transaction(async (tx) => {
      // Update invitation status
      await tx.staffInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' },
      });

      // Find and update the user record
      // (created during onboarding or invite with placeholder clerkId)
      await tx.user.updateMany({
        where: {
          email: invitation.email,
          orgId: invitation.orgId,
        },
        data: {
          clerkId: data.clerkId,
          status: 'ACTIVE',
        },
      });
    });

    await this.notificationService.notifyByRoles(
      invitation.orgId!,
      ['OWNER', 'ADMIN', 'MEMBER'],
      `Accept Invitation`,
      `${invitation.name} has accepted your invitation`,
      'STAFF',
    );

    this.logger.log(`Invitation accepted: ${invitation.email}`);

    return { success: true, message: 'Invitation accepted' };
  }
}
