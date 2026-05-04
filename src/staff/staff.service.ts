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
    const users = await this.prisma.db.user.findMany({
      where: { orgId: user.orgId! },
      orderBy: { createdAt: 'asc' },
    });

    const invitations = await this.prisma.db.staffInvitation.findMany({
      where: {
        orgId: user.orgId!,
        status: { in: ['PENDING', 'RESENT', 'EXPIRED'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    this.logger.log(`Get all staff org: ${user.org?.name}`);

    return { users, invitations };
  }

  // POST — invite a new staff member
  async inviteStaff(user: AuthenticatedUser, data: StaffDto) {
    // Check if this email already exists in THIS org
    const existingUser = await this.prisma.db.user.findFirst({
      where: { email: data.email, orgId: user.orgId! },
    });

    if (existingUser)
      throw new BadRequestException('This email is already in your team');

    // Check if email already has a PENDING invitation
    const existingInvite = await this.prisma.db.staffInvitation.findFirst({
      where: {
        email: data.email,
        orgId: user.orgId!,
        status: { in: ['PENDING', 'RESENT'] },
      },
    });
    if (existingInvite)
      throw new BadRequestException(
        'An invitation is already pending for this email',
      );

    const token = crypto.randomUUID();

    const invitation = await this.prisma.db.staffInvitation.create({
      data: {
        token,
        name: `${data.firstName} ${data.lastName}`.trim(),
        email: data.email,
        role: data.role,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        status: 'PENDING',
        orgId: user.orgId!,
      },
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

    return invitation;
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

    return { message: 'Role updated' };
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

    return { message: 'Staff member removed' };
  }
}
