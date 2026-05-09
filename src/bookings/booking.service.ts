import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../common/types/index.js';
import { BookingSource, BookingStatus } from '../generated/prisma/enums.js';
import {
  CreateBookingDto,
  GetBookingsQueryDto,
  UpdateBookingDto,
} from './booking.dto.js';
import { EmailService } from '../email/email.service.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
  ) {}

  //GET all bookings
  async getAllBookings(user: AuthenticatedUser, query: GetBookingsQueryDto) {
    const { status, staffId, search, from, to, page = 1, limit = 10 } = query;

    // Base filter — applies to BOTH list and stats
    const baseWhere: any = { orgId: user.orgId! };

    if (staffId) baseWhere.userId = staffId;

    // Date range filter on startAt
    if (from || to) {
      baseWhere.startAt = {};
      if (from) baseWhere.startAt.gte = from;
      if (to) baseWhere.startAt.lte = to;
    }

    // Search across customer name/email + service name
    if (search) {
      baseWhere.OR = [
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { email: { contains: search, mode: 'insensitive' } } },
        { service: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // List filter = base + status (stats query ignores status)
    const listWhere = status ? { ...baseWhere, status } : baseWhere;

    // Pagination math
    const skip = (page - 1) * limit;

    // Run all three queries in parallel
    const [bookings, total, statusGroups] = await Promise.all([
      //get the stack of books — apply ALL filters
      this.prisma.db.booking.findMany({
        where: listWhere,
        include: { service: true, customer: true, user: true },
        orderBy: { startAt: 'asc' },
        skip,
        take: limit,
      }),

      // Count for pagination — apply ALL filters
      this.prisma.db.booking.count({ where: listWhere }),

      //count the counter — apply EVERYTHING EXCEPT genre/status
      this.prisma.db.booking.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

    // Reshape groupBy result into flat stats object
    const stats = {
      total: 0,
      pending: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
    };

    for (const group of statusGroups) {
      const count = group._count._all;
      stats.total += count;

      switch (group.status) {
        case 'PENDING':
          stats.pending = count;
          break;
        case 'CONFIRMED':
          stats.confirmed = count;
          break;
        case 'COMPLETED':
          stats.completed = count;
          break;
        case 'CANCELLED':
          stats.cancelled = count;
          break;
        case 'NO_SHOW':
          stats.noShow = count;
          break;
      }
    }

    return {
      data: bookings,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      stats,
    };
  }

  //POST create booking
  async createBooking(user: AuthenticatedUser, data: CreateBookingDto) {
    // Check service exists and belongs to org
    const service = await this.prisma.db.service.findUnique({
      where: { id: data.serviceId },
    });

    if (!service || service.orgId !== user.orgId) {
      throw new NotFoundException('Service not found');
    }

    // compute endAt from service duration
    const endAt = new Date(
      data.startAt.getTime() + service.durationMins * 60000,
    );

    const booking = await this.prisma.db.$transaction(async (tx) => {
      // Step 1: Resolve customer ID
      let customerId: string;

      if (data.customerId) {
        // Existing customer — verify they belong to this org
        const existing = await tx.customer.findUnique({
          where: { id: data.customerId },
        });

        if (!existing || existing.orgId !== user.orgId) {
          throw new NotFoundException('Customer not found');
        }

        customerId = existing.id;
      } else if (data.customer) {
        // New customer — create them
        const newCustomer = await tx.customer.create({
          data: {
            name: data.customer.name,
            email: data.customer.email,
            phone: data.customer.phone,
            orgId: user.orgId!,
          },
        });

        customerId = newCustomer.id;
      } else {
        throw new BadRequestException('Customer info is required');
      }

      // Step 2: Create booking
      const newBooking = await tx.booking.create({
        data: {
          startAt: data.startAt,
          endAt,
          source: 'MANUAL_DASHBOARD',
          status: 'PENDING',
          note: data.note || null,
          customerId,
          serviceId: data.serviceId,
          userId: data.staffId || null,
          orgId: user.orgId!,
        },
        include: {
          service: true,
          customer: true,
          user: true,
        },
      });

      return newBooking;
    });

    await this.emailService.sendBookingConfirmationEmail(
      booking.customer.email,
      booking.customer.name,
      user.org?.name || '',
      booking.service.name,
      booking.user
        ? `${booking.user.firstName} ${booking.user.lastName}`
        : null,
      booking.startAt.toLocaleDateString(),
      booking.startAt.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    );

    // After booking is created:
    await this.notificationService.notifyOrgAdmins(
      user.orgId!,
      'New Booking',
      `${booking.customer.name} booked ${booking.service.name}`,
      'BOOKING',
      'BOOKING',
      booking.id,
    );

    this.logger.log(`Booking created: ${booking.id}`);

    return booking;
  }

  async updateBooking(
    user: AuthenticatedUser,
    id: string,
    data: UpdateBookingDto,
  ) {
    const booking = await this.prisma.db.booking.findUnique({
      where: { id },
      include: { customer: true, service: true },
    });

    if (!booking || booking.orgId !== user.orgId) {
      throw new NotFoundException('Booking not found');
    }

    if (data.status === 'CANCELLED') {
      if (booking.status === 'CANCELLED') {
        throw new BadRequestException('Booking is already cancelled');
      }
      if (booking.status === 'COMPLETED') {
        throw new BadRequestException('Cannot cancel a completed booking');
      }
    }

    const updatedBooking = await this.prisma.db.booking.update({
      where: { id },
      data: {
        status: data.status,
      },
    });

    await this.emailService.sendBookingStatusEmail(
      booking.customer.email,
      booking.customer.name,
      user.org?.name || '',
      booking.service.name,
      data.status,
      booking.startAt.toLocaleDateString(),
      booking.startAt.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    );

    if (booking.userId) {
      await this.notificationService.createNotification(
        booking.userId,
        user.orgId!,
        'Booking Updated',
        `Booking for ${booking.customer.name} (${booking.service.name}) is now ${data.status.toLowerCase()}`,
        'BOOKING',
        'BOOKING',
        booking.id,
      );
    }

    this.logger.log(`Booking updated: ${updatedBooking.id}`);

    return updatedBooking;
  }
}
