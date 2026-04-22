import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../common/types/index.js';
import { StaffDto } from '../onboarding/onboarding.dto.js';
import { ChangeRoleDto } from './staff.dto.js';
import { EmailService } from '../email/email.service.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
  ) {}

  //GET - fetch staff details

  async getAllStaff(user: AuthenticatedUser) {
    const staff = await this.prisma.db.user.findMany({
      where: { orgId: user.orgId! },
    });

    this.logger.log(`Get all staff org: ${user.org?.name}`);

    return { success: true, data: staff };
  }

  // POST — invite a new staff member
  async inviteStaff(user: AuthenticatedUser, data: StaffDto) {
    // Check if this email already exists in THIS org
    const existingUser = await this.prisma.db.user.findFirst({
      where: { email: data.email, orgId: user.orgId! },
    });

    if (existingUser)
      throw new BadRequestException('This email is already in your team');

    const { firstName, lastName, email, phone, role } = data;

    const token = crypto.randomUUID();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.staffInvitation.create({
        data: {
          token,
          name: `${firstName} ${lastName}`.trim(),
          email: email,
          role,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          status: 'PENDING',
          orgId: user.orgId!,
        },
      });

      // Create user record (INACTIVE until they accept)
      await tx.user.create({
        data: {
          clerkId: `pending_${crypto.randomUUID()}`,
          email,
          firstName,
          lastName,
          phone,
          role,
          status: 'INACTIVE',
          profileComplete: false,
          onboardingComplete: true,
          orgId: user.orgId,
        },
      });
    });

    await this.emailService.sendInvitationEmail(
      data.email,
      user.org?.name || '',
      `${data.firstName} ${data.lastName}`.trim(),
      data.role,
      token,
    );

    await this.notificationService.notifyOrgAdmins(
      user.orgId!,
      'Staff Invited',
      `${data.firstName} ${data.lastName} was invited to join`,
      'STAFF',
    );

    this.logger.log(`Staff invited: ${data.email}`);

    return { success: true, message: 'Invitation sent successfully' };
  }

  async reSendInvitation(user: AuthenticatedUser, id: string) {
    // Find the invitation
    const invitation = await this.prisma.db.staffInvitation.findUnique({
      where: { id },
    });

    if (!invitation) throw new NotFoundException('Invitation not found');

    if (invitation.orgId !== user.orgId)
      throw new ForbiddenException('Not your invitation');

    if (invitation.status === 'ACCEPTED')
      throw new BadRequestException('Invitation already accepted');
    const newToken = crypto.randomUUID();
    // Update with new token and expiry
    await this.prisma.db.staffInvitation.update({
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

    return { success: true, message: 'Invitation resent successfully' };
  }

  async changeStaffRole(
    user: AuthenticatedUser,
    id: string,
    data: ChangeRoleDto,
  ) {
    if (user.role !== 'OWNER')
      throw new ForbiddenException('Only the owner can change roles');

    if (id === user.id)
      throw new BadRequestException('Cannot change your own role');

    if (data.role === 'OWNER')
      throw new BadRequestException('Cannot assign OWNER role');

    const staff = await this.prisma.db.user.findUnique({
      where: { id },
    });

    if (!staff) throw new NotFoundException('Staff member not found');

    if (staff.orgId !== user.orgId)
      throw new ForbiddenException('Not in your organisation');

    if (staff.role === 'OWNER')
      throw new BadRequestException("Cannot change the owner's role");

    const updated = await this.prisma.db.user.update({
      where: { id },
      data: { role: data.role },
    });

    await this.notificationService.createNotification(
      staff.id,
      staff.orgId!,
      `Role Change`,
      `Your role  has been  change to ${data.role}`,
      'ROLE',
    );

    this.logger.log(`Role changed: ${updated.email} → ${updated.role}`);

    return { success: true, message: 'Role updated' };
  }

  // DELETE — delete staff member

  async deleteStaff(user: AuthenticatedUser, id: string) {
    if (user.role !== 'OWNER')
      throw new ForbiddenException('Only the owner can remove staff');

    if (id === user.id) throw new BadRequestException('Cannot remove yourself');

    const staff = await this.prisma.db.user.findUnique({
      where: { id },
    });

    if (!staff) throw new NotFoundException('Staff member not found');

    if (staff.orgId !== user.orgId)
      throw new ForbiddenException('Not in your organisation');

    if (staff.role === 'OWNER')
      throw new BadRequestException('Cannot remove the owner');

    await this.prisma.db.$transaction(async (tx) => {
      // Soft-remove the user (keep for booking history)
      await tx.user.update({
        where: { id },
        data: {
          status: 'REMOVED',
          orgId: null,
        },
      });

      // Delete their invitation if exists
      await tx.staffInvitation.deleteMany({
        where: { email: staff.email, orgId: user.orgId! },
      });
    });

    await this.notificationService.notifyByRoles(
      user.orgId!,
      ['OWNER', 'ADMIN'],
      `User removed`,
      ` ${staff.firstName} has been removed from your organisation`,
      'STAFF',
    );

    this.logger.log(`Staff removed: ${staff.email}`);

    return { success: true, message: 'Staff member removed' };
  }
}
