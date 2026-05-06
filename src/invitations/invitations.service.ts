import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AcceptInvitationDto } from './invitations.dto.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../common/types/index.js';
import { EmailService } from '../email/email.service.js';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
  ) {}

  //GET - fetch invitation details
  async getInvitation(token: string) {
    const invitation = await this.prisma.db.staffInvitation.findUnique({
      where: { token },
      include: {
        org: {
          include: {
            users: {
              where: { role: 'OWNER', status: 'ACTIVE' },
              select: { firstName: true, lastName: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!invitation) throw new NotFoundException('Invalid invitation link');

    const owner = invitation.org.users[0];
    const invitedBy = owner
      ? `${owner.firstName} ${owner.lastName}`.trim()
      : invitation.org.name;

    // Check if expired — update status on read
    if (invitation.status !== 'ACCEPTED' && invitation.expiresAt < new Date()) {
      await this.prisma.db.staffInvitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });

      invitation.status = 'EXPIRED';
    }

    return {
      name: invitation.name,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      orgName: invitation.org.name,
      orgLogo: invitation.org.logo,
      invitedBy,
      expiresAt: invitation.expiresAt,
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

    if (invitation.status === 'CANCELLED') {
      throw new BadRequestException('Invitation has been cancelled');
    }

    if (invitation.expiresAt < new Date()) {
      await this.prisma.db.staffInvitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('Invitation has expired');
    }

    // Split the stored "First Last" name back into parts
    const nameParts = invitation.name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    await this.prisma.db.$transaction(async (tx) => {
      // Update invitation status
      await tx.staffInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' },
      });

      // CREATE the user (no longer updateMany)
      await tx.user.create({
        data: {
          clerkId: data.clerkId,
          email: invitation.email,
          firstName,
          lastName,
          role: invitation.role,
          status: 'ACTIVE',
          profileComplete: false,
          onboardingComplete: true, // they didn't onboard the org, the owner did
          orgId: invitation.orgId,
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

    return { message: 'Invitation accepted' };
  }

  // POST — resend an invitation (admin/owner only)
  async reSendInvitation(user: AuthenticatedUser, id: string) {
    const invitation = await this.prisma.db.staffInvitation.findUnique({
      where: { id },
    });

    if (!invitation) throw new NotFoundException('Invitation not found');

    if (invitation.orgId !== user.orgId)
      throw new ForbiddenException('Not your invitation');

    if (invitation.status === 'ACCEPTED')
      throw new BadRequestException('Invitation already accepted');

    const newToken = crypto.randomUUID();

    const updated = await this.prisma.db.staffInvitation.update({
      where: { id },
      data: {
        token: newToken,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        status: 'RESENT',
      },
    });

    await this.emailService.sendInvitationEmail(
      invitation.email,
      user.org?.name || '',
      invitation.name,
      invitation.role,
      newToken,
    );

    this.logger.log(`Invitation resent for: ${invitation.email}`);

    return updated;
  }

  // PATCH — cancel a pending invitation (admin/owner only)
  async cancelInvitation(user: AuthenticatedUser, id: string) {
    const invitation = await this.prisma.db.staffInvitation.findUnique({
      where: { id },
    });

    if (!invitation) throw new NotFoundException('Invitation not found');

    if (invitation.orgId !== user.orgId)
      throw new ForbiddenException('Not your invitation');

    if (invitation.status === 'ACCEPTED')
      throw new BadRequestException(
        'Cannot cancel an already accepted invitation',
      );

    if (invitation.status === 'CANCELLED')
      throw new BadRequestException('Invitation is already cancelled');

    const updated = await this.prisma.db.staffInvitation.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    this.logger.log(
      `Invitation cancelled for: ${invitation.email} by ${user.email}`,
    );

    return updated;
  }
}
