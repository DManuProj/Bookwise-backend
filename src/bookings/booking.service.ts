import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../common/types/index.js';
import { DayOfWeek } from '../generated/prisma/enums.js';
import {
  CreateBookingDto,
  GetBookingSlotsDto,
  GetBookingsQueryDto,
  UpdateBookingDataDto,
  UpdateBookingStatusDto,
} from './booking.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../email/email.service.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  checkTierCap,
  TIER_LIMITS,
  UNLIMITED,
} from '../common/constants/tier-limits.constant.js';
import { startOfMonth } from 'date-fns';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
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

  //GET all booking slots
  async getAvailableSlots(user: AuthenticatedUser, query: GetBookingSlotsDto) {
    const { serviceId, staffId, date } = query;

    //  Service check
    const service = await this.prisma.db.service.findUnique({
      where: { id: serviceId },
    });

    if (!service || service.orgId !== user.orgId || service.isDeleted) {
      throw new NotFoundException('Service not found');
    }

    // Staff check
    const staff = await this.prisma.db.user.findUnique({
      where: { id: staffId },
    });

    if (!staff || staff.orgId !== user.orgId) {
      throw new NotFoundException('Staff member not found');
    }

    //  Day of week
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayOfWeek = dayNames[date.getDay()];

    const [org, hours] = await Promise.all([
      this.prisma.db.organisation.findUnique({ where: { id: user.orgId! } }),
      this.prisma.db.workingHour.findFirst({
        where: { orgId: user.orgId!, day: dayOfWeek as DayOfWeek },
      }),
    ]);

    if (!org) throw new NotFoundException('Organisation not found');

    // Closed check
    if (!hours || !hours.isOpen) return [];

    //get existing bookings for the day
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const existingBookings = await this.prisma.db.booking.findMany({
      where: {
        userId: staffId,
        orgId: user.orgId!,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { gte: dayStart, lte: dayEnd },
        ...(query.excludeBookingId && { id: { not: query.excludeBookingId } }),
      },
    });

    //all slots
    const slotDuration = service.durationMins;
    const buffer = service.buffer || org!.bufferMins || 0;

    const [openH, openM] = hours.openTime.split(':').map(Number);
    const [closeH, closeM] = hours.closeTime.split(':').map(Number);
    const openMins = openH * 60 + openM;
    const closeMins = closeH * 60 + closeM;

    const allSlots: string[] = [];
    for (let mins = openMins; mins + slotDuration <= closeMins; mins += 30) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      allSlots.push(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      );
    }

    //Filter conflicting slots
    const availableSlots = allSlots.filter((slot) => {
      const [slotH, slotM] = slot.split(':').map(Number);
      const slotStart = slotH * 60 + slotM;
      const slotEnd = slotStart + slotDuration + buffer;

      const hasConflict = existingBookings.some((booking) => {
        const bookingStart =
          booking.startAt.getHours() * 60 + booking.startAt.getMinutes();
        const bookingEnd =
          booking.endAt.getHours() * 60 + booking.endAt.getMinutes() + buffer;

        // Standard overlap check
        return slotStart < bookingEnd && slotEnd > bookingStart;
      });

      return !hasConflict;
    });

    //Filter past slots if today
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const requestDate = date.toISOString().split('T')[0];

    if (requestDate !== today) return availableSlots;

    const currentMins = now.getHours() * 60 + now.getMinutes();
    const leadTime = org!.minLeadTimeMins || 0;
    const minBookingTime = currentMins + leadTime;

    this.logger.log(
      `Slots for staff ${staffId} on ${requestDate}: ${availableSlots.length} available`,
    );
    return availableSlots.filter((slot) => {
      const [h, m] = slot.split(':').map(Number);
      return h * 60 + m >= minBookingTime;
    });
  }

  //POST create booking
  async createBooking(user: AuthenticatedUser, data: CreateBookingDto) {
    // Tier cap check
    const cap = TIER_LIMITS[user.org!.planTier].bookingsPerMonth;

    if (cap !== UNLIMITED) {
      const bookingsThisMonth = await this.prisma.db.booking.count({
        where: {
          orgId: user.orgId!,
          createdAt: { gte: startOfMonth(new Date()) },
        },
      });

      checkTierCap(user.org!.planTier, 'bookingsPerMonth', bookingsThisMonth);
    }
    //  Service exists + belongs to org
    const service = await this.prisma.db.service.findUnique({
      where: { id: data.serviceId },
    });

    if (!service || service.orgId !== user.orgId || service.isDeleted) {
      throw new NotFoundException('Service not found');
    }

    // Reject past bookings
    const now = new Date();
    if (data.startAt < now) {
      throw new BadRequestException('Cannot book a time in the past.');
    }

    // Staff exists + belongs to org ──
    const staff = await this.prisma.db.user.findUnique({
      where: { id: data.staffId },
    });

    if (!staff || staff.orgId !== user.orgId) {
      throw new NotFoundException('Staff member not found');
    }

    //  Compute endAt
    const endAt = new Date(
      data.startAt.getTime() + service.durationMins * 60000,
    );

    //  Working hours check ──
    // NOTE: assumes server time matches org's local time.
    // Timezone-aware version is in end-of-project list.
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayOfWeek = dayNames[data.startAt.getDay()];

    const hours = await this.prisma.db.workingHour.findFirst({
      where: { orgId: user.orgId!, day: dayOfWeek as DayOfWeek },
    });

    if (!hours || !hours.isOpen) {
      throw new BadRequestException('The business is closed on this day.');
    }

    const startMins = data.startAt.getHours() * 60 + data.startAt.getMinutes();
    const endMins = endAt.getHours() * 60 + endAt.getMinutes();
    const [openH, openM] = hours.openTime.split(':').map(Number);
    const [closeH, closeM] = hours.closeTime.split(':').map(Number);
    const openMins = openH * 60 + openM;
    const closeMins = closeH * 60 + closeM;

    if (startMins < openMins || endMins > closeMins) {
      throw new BadRequestException(
        `Booking must be between ${hours.openTime} and ${hours.closeTime}.`,
      );
    }

    const buffer = service.buffer ?? user.org?.bufferMins ?? 0;
    const bufferedEnd = new Date(endAt.getTime() + buffer * 60000);

    // Transaction: customer resolution + conflict check + booking creation ──
    const booking = await this.prisma.db.$transaction(async (tx) => {
      // Conflict check inside transaction — prevents race condition where two
      // simultaneous requests both pass the check and create overlapping bookings
      const conflict = await tx.booking.findFirst({
        where: {
          userId: data.staffId,
          orgId: user.orgId!,
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startAt: { lt: bufferedEnd },
          endAt: { gt: data.startAt },
        },
      });

      if (conflict) {
        this.logger.log(
          `Booking conflict: staff ${data.staffId} already booked ${conflict.id}`,
        );
        throw new ConflictException(
          'This staff member already has a booking that overlaps this time.',
        );
      }

      let customerId: string;

      if (data.customerId) {
        // Owner picked from search → use existing customer
        const existing = await tx.customer.findUnique({
          where: { id: data.customerId },
        });

        if (!existing || existing.orgId !== user.orgId) {
          throw new NotFoundException('Customer not found');
        }

        customerId = existing.id;
      } else if (data.customer) {
        // Owner typed details → must be a brand new customer
        const existingByEmail = await tx.customer.findUnique({
          where: {
            email_orgId: {
              email: data.customer.email,
              orgId: user.orgId!,
            },
          },
        });

        if (existingByEmail) {
          throw new ConflictException(
            'A customer with this email already exists. Please search and select them from the list.',
          );
        }

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

      const newBooking = await tx.booking.create({
        data: {
          startAt: data.startAt,
          endAt,
          source: 'MANUAL_DASHBOARD',
          status: 'PENDING',
          note: data.note || null,
          customerId,
          serviceId: data.serviceId,
          userId: data.staffId,
          orgId: user.orgId!,
        },
        include: { service: true, customer: true, user: true },
      });

      return newBooking;
    });

    //  Side effects: email + notification
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

    await this.notificationService.notifyOrgAdmins(
      user.orgId!,
      'New Booking',
      `${booking.customer.name} booked ${booking.service.name}`,
      'BOOKING',
      'BOOKING',
      booking.id,
    );

    await this.auditService.log({
      orgId: user.orgId!,
      userId: user.id,
      actorName: `${user.firstName} ${user.lastName}`,
      action: 'BOOKING_CREATED',
      entityType: 'Booking',
      entityId: booking.id,
      metadata: {
        customerName: booking.customer.name,
        serviceName: booking.service.name,
        startAt: booking.startAt,
        source: booking.source,
      },
    });

    if (data.customer) {
      await this.auditService.log({
        orgId: user.orgId!,
        userId: user.id,
        actorName: `${user.firstName} ${user.lastName}`,
        action: 'CUSTOMER_CREATED',
        entityType: 'Customer',
        entityId: booking.customerId,
        metadata: {
          name: booking.customer.name,
          email: booking.customer.email,
        },
      });
    }

    this.logger.log(`Booking created: ${booking.id}`);

    return booking;
  }

  //PATCH update booking data (time/service/staff/note)
  async updateBookingData(
    user: AuthenticatedUser,
    id: string,
    data: UpdateBookingDataDto,
  ) {
    // ── 1. Fetch existing booking ──
    const existingBooking = await this.prisma.db.booking.findUnique({
      where: { id },
      include: { service: true, customer: true, user: true },
    });

    if (!existingBooking || existingBooking.orgId !== user.orgId) {
      throw new NotFoundException('Booking not found');
    }

    if (existingBooking.status !== 'PENDING') {
      throw new BadRequestException('Only pending bookings can be edited');
    }

    // ── 2. Resolve effective service ──
    // If serviceId changed, fetch and verify the new one. Else reuse existing.
    let service = existingBooking.service;
    if (data.serviceId && data.serviceId !== existingBooking.serviceId) {
      const newService = await this.prisma.db.service.findUnique({
        where: { id: data.serviceId },
      });
      if (!newService || newService.orgId !== user.orgId || newService.isDeleted) {
        throw new NotFoundException('Service not found');
      }
      service = newService;
    }

    //  Resolve effective staff ──
    let staffId = existingBooking.userId!;
    if (data.staffId && data.staffId !== existingBooking.userId) {
      const newStaff = await this.prisma.db.user.findUnique({
        where: { id: data.staffId },
      });
      if (!newStaff || newStaff.orgId !== user.orgId) {
        throw new NotFoundException('Staff member not found');
      }
      staffId = newStaff.id;
    }

    //Resolve effective start/end times
    const startAt = data.startAt ?? existingBooking.startAt;
    const endAt = new Date(startAt.getTime() + service.durationMins * 60000);

    // ── 5. Past booking check ──
    if (startAt < new Date()) {
      throw new BadRequestException(
        'Cannot move booking to a time in the past.',
      );
    }

    // Working hours check
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayOfWeek = dayNames[startAt.getDay()];

    const hours = await this.prisma.db.workingHour.findFirst({
      where: { orgId: user.orgId!, day: dayOfWeek as DayOfWeek },
    });

    if (!hours || !hours.isOpen) {
      throw new BadRequestException('The business is closed on this day.');
    }

    const startMins = startAt.getHours() * 60 + startAt.getMinutes();
    const endMins = endAt.getHours() * 60 + endAt.getMinutes();
    const [openH, openM] = hours.openTime.split(':').map(Number);
    const [closeH, closeM] = hours.closeTime.split(':').map(Number);
    const openMins = openH * 60 + openM;
    const closeMins = closeH * 60 + closeM;

    if (startMins < openMins || endMins > closeMins) {
      throw new BadRequestException(
        `Booking must be between ${hours.openTime} and ${hours.closeTime}.`,
      );
    }

    // Overlap check — EXCLUDE this booking from search
    const buffer = service.buffer ?? user.org?.bufferMins ?? 0;
    const bufferedEnd = new Date(endAt.getTime() + buffer * 60000);

    const conflict = await this.prisma.db.booking.findFirst({
      where: {
        id: { not: id }, //  ignore self
        userId: staffId,
        orgId: user.orgId!,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { lt: bufferedEnd },
        endAt: { gt: startAt },
      },
    });

    if (conflict) {
      throw new ConflictException(
        'This staff member already has a booking that overlaps this time.',
      );
    }

    // Update
    const updated = await this.prisma.db.booking.update({
      where: { id },
      data: {
        startAt,
        endAt,
        serviceId: service.id,
        userId: staffId,
        ...(data.note !== undefined && { note: data.note || null }),
      },
      include: { service: true, customer: true, user: true },
    });

    await this.auditService.log({
      orgId: user.orgId!,
      userId: user.id,
      actorName: `${user.firstName} ${user.lastName}`,
      action: 'BOOKING_UPDATED',
      entityType: 'Booking',
      entityId: updated.id,
      metadata: {
        customerName: updated.customer.name,
        serviceName: updated.service.name,
        startAt: updated.startAt,
        changedFields: Object.keys(data).filter(
          (k) => data[k as keyof typeof data] !== undefined,
        ),
      },
    });

    this.logger.log(`Booking updated: ${updated.id}`);

    return updated;
  }

  async updateBookingStatus(
    user: AuthenticatedUser,
    id: string,
    data: UpdateBookingStatusDto,
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

    if (data.status === 'CANCELLED' || data.status === 'COMPLETED') {
      await this.auditService.log({
        orgId: user.orgId!,
        userId: user.id,
        actorName: `${user.firstName} ${user.lastName}`,
        action:
          data.status === 'CANCELLED'
            ? 'BOOKING_CANCELLED'
            : 'BOOKING_COMPLETED',
        entityType: 'Booking',
        entityId: booking.id,
        metadata: {
          customerName: booking.customer.name,
          serviceName: booking.service.name,
          startAt: booking.startAt,
        },
      });
    }

    this.logger.log(`Booking updated: ${updatedBooking.id}`);

    return updatedBooking;
  }
}
