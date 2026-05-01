import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../common/types/index.js';
import {
  UpdateOrganisationDto,
  UpdateWorkingHoursDto,
} from './organisation.dto.js';
import { WorkingHourDto } from '../onboarding/onboarding.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class OrganisationService {
  private readonly logger = new Logger(OrganisationService.name);

  constructor(private readonly prisma: PrismaService) {}

  // GET — fetch the user's organisation
  async getOrganisation(user: AuthenticatedUser) {
    const org = await this.prisma.db.organisation.findUnique({
      where: { id: user.orgId! },
      include: {
        workingHours: true,
      },
    });

    if (!org) {
      throw new NotFoundException('Organisation not found');
    }

    return org;
  }

  // PUT — update business info
  async updateOrganisation(
    user: AuthenticatedUser,
    data: UpdateOrganisationDto,
  ) {
    // Check slug uniqueness if slug is being changed
    if (data.slug) {
      const existing = await this.prisma.db.organisation.findFirst({
        where: {
          slug: data.slug,
          isDeleted: false,
          NOT: { id: user.orgId! },
        },
      });

      if (existing) throw new BadRequestException('Slug is already taken');
    }

    // Update only the fields that were sent
    const updatedOrg = await this.prisma.db.organisation.update({
      where: { id: user.orgId! },
      data,
    });

    this.logger.log(`Organisation updated: ${updatedOrg.slug}`);

    return updatedOrg;
  }

  // updatating working hours
  async updateOrganisationHours(
    user: AuthenticatedUser,
    data: UpdateWorkingHoursDto,
  ) {
    const result = await this.prisma.db.$transaction(async (tx) => {
      // Delete all existing hours for this org
      await tx.workingHour.deleteMany({
        where: { orgId: user.orgId! },
      });

      await tx.workingHour.createMany({
        data: data.workingHours.map((hour) => ({
          day: hour.day,
          isOpen: hour.isOpen,
          openTime: hour.openTime,
          closeTime: hour.closeTime,
          orgId: user.orgId!,
        })),
      });

      const workingHours = await tx.workingHour.findMany({
        where: { orgId: user.orgId! },
        orderBy: { day: 'asc' },
      });
      this.logger.log(`Working hours updated for: ${user.email}`);
      return workingHours;
    });

    return result;
  }

  async deleteOrganisation(user: AuthenticatedUser) {
    // Guard: only OWNER can delete
    if (user.role !== 'OWNER')
      throw new ForbiddenException(
        'Only the owner can delete the organisation',
      );

    // Check for upcoming confirmed bookings
    const upComingBookings = await this.prisma.db.booking.count({
      where: {
        orgId: user.orgId!,
        status: { in: ['CONFIRMED', 'PENDING'] },
        startAt: { gte: new Date() },
      },
    });

    if (upComingBookings > 0)
      throw new BadRequestException(
        `Cannot delete — you have ${upComingBookings} upcoming confirmed booking(s). Cancel them first.`,
      );

    await this.prisma.db.$transaction(async (tx) => {
      //mark as org deleted
      await tx.organisation.update({
        where: { id: user.orgId! },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });

      // Unlink all users from this org
      await tx.user.updateMany({
        where: { orgId: user.orgId! },
        data: { orgId: null },
      });

      this.logger.warn(`Organisation soft-deleted by: ${user.email}`);
    });
    return {
      message: 'Organisation deleted',
    };
  }
}
