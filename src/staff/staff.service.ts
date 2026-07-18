import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../common/types/index.js';
import { StaffDto } from '../onboarding/onboarding.dto.js';
import { ChangeRoleDto, UnfreezeStaffDto } from './staff.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../email/email.service.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  checkTierCap,
  TIER_LIMITS,
  UNLIMITED,
} from '../common/constants/tier-limits.constant.js';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
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
    const [activeStaff, pendingInvites] = await Promise.all([
      this.prisma.db.user.count({
        where: { orgId: user.orgId!, status: 'ACTIVE', staffActive: true },
      }),
      this.prisma.db.staffInvitation.count({
        where: { orgId: user.orgId!, status: { in: ['PENDING', 'RESENT'] } },
      }),
    ]);

    checkTierCap(user.org!.planTier, 'staff', activeStaff + pendingInvites);

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

    await this.auditService.log({
      orgId: user.orgId!,
      userId: user.id,
      actorName: `${user.firstName} ${user.lastName}`,
      action: 'STAFF_INVITED',
      entityType: 'StaffInvitation',
      entityId: invitation.id,
      metadata: {
        inviteeName: invitation.name,
        inviteeEmail: invitation.email,
        role: invitation.role,
      },
    });

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
      `Your role has been changed to ${data.role}`,
      'ROLE',
    );

    await this.notificationService.notifyByRoles(
      user.orgId!,
      ['OWNER'],
      'Role Changed',
      `${staff.firstName} ${staff.lastName}'s role has been changed to ${data.role}`,
      'STAFF',
    );

    this.logger.log(`Role changed: ${updated.email} → ${updated.role}`);

    return { message: 'Role updated' };
  }

  // PUT — freeze a staff member (staffActive = false)
  async freezeStaff(user: AuthenticatedUser, id: string) {
    if (user.role !== 'OWNER')
      throw new ForbiddenException('Only the owner can freeze staff');

    const staff = await this.prisma.db.user.findUnique({
      where: { id },
    });

    if (!staff) throw new NotFoundException('Staff member not found');

    if (staff.orgId !== user.orgId)
      throw new ForbiddenException('Not in your organisation');

    // Intentionally no self-target or target-is-OWNER block:
    // the owner may freeze themselves (owner-as-staff toggle).

    if (!staff.staffActive) return { message: 'Already frozen' };

    await this.prisma.db.user.update({
      where: { id },
      data: { staffActive: false },
    });

    // Skip the personal notification when the owner froze themselves
    if (id !== user.id) {
      await this.notificationService.createNotification(
        staff.id,
        staff.orgId!,
        'Removed from bookings',
        'You have been set inactive and will not receive new bookings.',
        'STAFF',
      );
    }

    await this.notificationService.notifyByRoles(
      user.orgId!,
      ['OWNER', 'ADMIN'],
      'Staff frozen',
      `${staff.firstName} ${staff.lastName} was set inactive.`,
      'STAFF',
    );

    this.logger.log(`Staff frozen: ${staff.email}`);

    return { message: 'Staff frozen' };
  }

  // PUT — unfreeze a staff member (staffActive = true)
  // At the tier cap this requires a swap: the caller must name an active
  // staff member to freeze so the active count never exceeds the cap.
  async unfreezeStaff(
    user: AuthenticatedUser,
    id: string,
    data: UnfreezeStaffDto,
  ) {
    if (user.role !== 'OWNER')
      throw new ForbiddenException('Only the owner can unfreeze staff');

    const staff = await this.prisma.db.user.findUnique({
      where: { id },
    });

    if (!staff) throw new NotFoundException('Staff member not found');

    if (staff.orgId !== user.orgId)
      throw new ForbiddenException('Not in your organisation');

    // Intentionally no self-target or target-is-OWNER block:
    // the owner may unfreeze themselves (owner-as-staff toggle).

    if (staff.staffActive) return { message: 'Already active' };

    // Same cap math as inviteStaff — pending invites consume cap too
    const [activeStaff, pendingInvites] = await Promise.all([
      this.prisma.db.user.count({
        where: { orgId: user.orgId!, status: 'ACTIVE', staffActive: true },
      }),
      this.prisma.db.staffInvitation.count({
        where: { orgId: user.orgId!, status: { in: ['PENDING', 'RESENT'] } },
      }),
    ]);
    const currentCount = activeStaff + pendingInvites;
    const cap = TIER_LIMITS[user.org!.planTier].staff;

    if (cap === UNLIMITED || currentCount < cap) {
      // Room under the cap — plain unfreeze
      await this.prisma.db.user.update({
        where: { id },
        data: { staffActive: true },
      });

      await this.notificationService.createNotification(
        staff.id,
        staff.orgId!,
        'Active again',
        'You are active again and can receive bookings.',
        'STAFF',
      );

      await this.notificationService.notifyByRoles(
        user.orgId!,
        ['OWNER', 'ADMIN'],
        'Staff activated',
        `${staff.firstName} ${staff.lastName} was set active.`,
        'STAFF',
      );

      this.logger.log(`Staff activated: ${staff.email}`);

      return { message: 'Staff activated' };
    }

    // At/over cap — a swap is required
    if (!data.freezeUserId) {
      throw new ConflictException({
        code: 'SWAP_REQUIRED',
        message:
          'You are at your active-staff limit. Choose a staff member to freeze.',
      });
    }

    if (data.freezeUserId === id)
      throw new BadRequestException(
        'Swap target must be a different staff member',
      );

    const swapOut = await this.prisma.db.user.findUnique({
      where: { id: data.freezeUserId },
    });

    if (!swapOut || swapOut.orgId !== user.orgId || !swapOut.staffActive)
      throw new BadRequestException(
        'Swap target must be an active staff member in your organisation',
      );

    // Both writes together so the active count never exceeds the cap
    await this.prisma.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: swapOut.id },
        data: { staffActive: false },
      });
      await tx.user.update({
        where: { id },
        data: { staffActive: true },
      });
    });

    await this.notificationService.createNotification(
      swapOut.id,
      swapOut.orgId!,
      'Removed from bookings',
      'You have been set inactive and will not receive new bookings.',
      'STAFF',
    );

    await this.notificationService.createNotification(
      staff.id,
      staff.orgId!,
      'Active again',
      'You are active again and can receive bookings.',
      'STAFF',
    );

    await this.notificationService.notifyByRoles(
      user.orgId!,
      ['OWNER', 'ADMIN'],
      'Staff swapped',
      `${staff.firstName} ${staff.lastName} was set active; ${swapOut.firstName} ${swapOut.lastName} was set inactive.`,
      'STAFF',
    );

    this.logger.log(`Staff swapped: ${staff.email} in, ${swapOut.email} out`);

    return { message: 'Staff swapped' };
  }

  // Auto-freeze the newest active staff until the org fits its tier's staff cap.
  // Called after every planTier write (Stripe webhooks + admin). Never throws —
  // a throw inside the Stripe webhook dispatch would make Stripe retry the event.
  async autoFreezeToStaffCap(orgId: string): Promise<void> {
    try {
      const org = await this.prisma.db.organisation.findUnique({
        where: { id: orgId },
        select: { id: true, planTier: true },
      });
      if (!org) return;

      const cap = TIER_LIMITS[org.planTier].staff;
      if (cap === UNLIMITED) return; // BUSINESS etc. — nothing to cap

      const activeCount = await this.prisma.db.user.count({
        where: { orgId, status: 'ACTIVE', staffActive: true },
      });
      if (activeCount <= cap) return; // already within cap — no-op (covers upgrades)

      const toFreeze = activeCount - cap;

      // newest-added active staff first
      const victims = await this.prisma.db.user.findMany({
        where: { orgId, status: 'ACTIVE', staffActive: true },
        orderBy: { createdAt: 'desc' },
        take: toFreeze,
        select: { id: true, firstName: true, lastName: true },
      });
      if (victims.length === 0) return;

      const victimIds = victims.map((v) => v.id);
      await this.prisma.db.user.updateMany({
        where: { id: { in: victimIds } },
        data: { staffActive: false },
      });

      // notify each frozen user + the owner/admins
      for (const v of victims) {
        await this.notificationService.createNotification(
          v.id,
          orgId,
          'Set inactive',
          'Your plan changed and you were set inactive — you will not receive new bookings until your organisation reactivates you.',
          'STAFF',
        );
      }
      await this.notificationService.notifyByRoles(
        orgId,
        ['OWNER', 'ADMIN'],
        'Staff auto-frozen',
        `${toFreeze} staff member(s) were set inactive because your plan now allows ${cap}. Reactivate or upgrade to change this.`,
        'STAFF',
      );

      this.logger.log(`Auto-froze ${toFreeze} staff for org ${orgId} (cap ${cap})`);
    } catch (err) {
      this.logger.error(
        `autoFreezeToStaffCap failed for ${orgId}: ${(err as Error).message}`,
      );
    }
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
