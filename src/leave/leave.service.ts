import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../generated/prisma/prisma.service.js';
import { AuthenticatedUser } from '../common/types/index.js';
import {
  CreateLeaveDto,
  GetLeaveQueryDto,
  UpdateLeaveStatusDto,
} from './leave.dto.js';
import { EmailService } from '../email/email.service.js';
import { LeaveStatus } from '../generated/prisma/client.js';

@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async getAllLeave(user: AuthenticatedUser, data: GetLeaveQueryDto) {
    const isAdmin = user.role === 'OWNER' || user.role === 'ADMIN';

    // const where = {
    //   orgId: user.orgId!,
    //   ...(data.status && { status: data.status }),
    //   ...(!isAdmin && { userId: user.id }),
    //   ...(isAdmin && data.userId && { userId: data.userId }),
    // };

    const where: any = {
      orgId: user.orgId!,
    };

    if (data.status) {
      where.status = data.status;
    }

    if (!isAdmin) {
      where.userId = user.id;
    }

    if (isAdmin && data.userId) {
      where.userId = data.userId;
    }

    const leaves = await this.prisma.db.staffLeave.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, data: leaves };
  }

  async requestLeave(user: AuthenticatedUser, dto: CreateLeaveDto) {
    const now = new Date();
    if (dto.startDate <= now) {
      throw new BadRequestException('Start date must be in the future');
    }
    if (dto.endDate <= dto.startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    const leave = await this.prisma.db.staffLeave.create({
      data: {
        startDate: dto.startDate,
        endDate: dto.endDate,
        reason: dto.reason,
        userId: user.id,
        orgId: user.orgId!,
      },
    });

    this.logger.log(`Leave requested by ${user.email}`);
    return { success: true, data: leave };
  }

  async updateLeaveStatus(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateLeaveStatusDto,
  ) {
    const leave = await this.prisma.db.staffLeave.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });

    if (!leave) throw new NotFoundException('Leave request not found');

    if (leave.orgId !== user.orgId)
      throw new ForbiddenException('Not your organization');

    if (
      leave.status === LeaveStatus.APPROVED ||
      leave.status === LeaveStatus.REJECTED
    ) {
      throw new BadRequestException(
        `Leave is already ${leave.status.toLowerCase()}`,
      );
    }

    if (leave.userId === user.id) {
      throw new ForbiddenException(
        'Cannot approve or reject your own leave request',
      );
    }

    const updated = await this.prisma.db.staffLeave.update({
      where: { id },
      data: { status: dto.status, approverId: user.id },
    });

    this.logger.log(`Leave ${id} ${dto.status} by ${user.email}`);

    const fmt = (d: Date) =>
      d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

    await this.emailService.sendLeaveStatusEmail(
      leave.user.email,
      `${leave.user.firstName} ${leave.user.lastName}`,
      fmt(leave.startDate),
      fmt(leave.endDate),
      dto.status,
    );

    return { success: true, data: updated };
  }

  async cancelLeave(user: AuthenticatedUser, id: string) {
    const leave = await this.prisma.db.staffLeave.findUnique({
      where: { id },
    });

    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.orgId !== user.orgId)
      throw new ForbiddenException('Not your organization');

    const isAdmin = user.role === 'OWNER' || user.role === 'ADMIN';
    if (!isAdmin && leave.userId !== user.id) {
      throw new ForbiddenException('Can only cancel your own leave requests');
    }

    if (leave.status !== LeaveStatus.PENDING) {
      throw new BadRequestException('Can only cancel pending leave requests');
    }

    await this.prisma.db.staffLeave.update({
      where: { id },
      data: { status: LeaveStatus.CANCELLED },
    });

    this.logger.log(`Leave ${id} cancelled by ${user.email}`);
    return { success: true, message: 'Leave request cancelled' };
  }
}
