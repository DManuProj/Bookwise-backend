import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../email/email.service.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  TIER_LIMITS,
  UNLIMITED,
} from '../common/constants/tier-limits.constant.js';
import { startOfMonth } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

@Injectable()
export class PublicBoookingService {
  private readonly logger = new Logger(PublicBoookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
  ) {}

  //GET  /api/public/:slug
  async getOrgBySlug(slug: string) {
    const org = await this.prisma.db.organisation.findUnique({
      where: { slug },
      include: {
        services: {
          where: { isActive: true, isDeleted: false },
          orderBy: { name: 'asc' },
        },
        users: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            photoUrl: true,
          },
        },
        workingHours: {
          orderBy: { day: 'asc' },
        },
      },
    });

    if (!org || org.isDeleted)
      throw new NotFoundException('Business not found');

    return {
      name: org.name,
      slug: org.slug,
      logo: org.logo,
      description: org.description,
      phone: org.phone,
      address: org.address,
      aiBookingAvailable:
        org.voiceAiEnabled &&
        (org.planTier === 'PRO' || org.planTier === 'BUSINESS'),
      services: org.services,
      staff: org.users,
      workingHours: org.workingHours,
    };
  }

  //GET  /api/public/:slug/slots
  async getAvailableSlots(
    slug: string,
    serviceId: string,
    date: string,
    staffId?: string,
  ) {
    // ── Step 1: Get org + working hours
    const org = await this.prisma.db.organisation.findUnique({
      where: { slug },
      include: {
        workingHours: { where: { userId: null } },
        users: { where: { status: 'ACTIVE' }, select: { id: true } },
      },
    });

    if (!org || org.isDeleted) {
      throw new NotFoundException('Business not found');
    }

    const orgTz = org.timezone || 'UTC';

    // ── Step 2: Get the service (need duration)
    const service = await this.prisma.db.service.findUnique({
      where: { id: serviceId },
    });

    if (!service || service.orgId !== org.id || service.isDeleted) {
      throw new NotFoundException('Service not found');
    }

    // ── Step 3: Find which day of the week
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const [yr, mo, dy] = date.split('-').map(Number);
    const dayOfWeek = dayNames[new Date(yr, mo - 1, dy).getDay()];

    // Find working hours for this day
    const hours = org.workingHours.find((h) => h.day === dayOfWeek);

    // If closed or no hours defined → no slots
    if (!hours || !hours.isOpen) {
      return [];
    }

    // ── Step 4: Get existing bookings for that day
    const dayStart = fromZonedTime(`${date}T00:00:00`, orgTz);
    const dayEnd = fromZonedTime(`${date}T23:59:59.999`, orgTz);

    const activeStaffIds = org.users.map((u) => u.id);

    const onLeave = await this.prisma.db.staffLeave.findMany({
      where: {
        orgId: org.id,
        userId: { in: activeStaffIds },
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lt: dayEnd },
        endDate: { gt: dayStart },
      },
      select: { userId: true },
    });
    const onLeaveIds = new Set(onLeave.map((l) => l.userId));
    const effectivePool = activeStaffIds.filter((id) => !onLeaveIds.has(id));

    if (staffId && onLeaveIds.has(staffId)) return [];
    if (!staffId && effectivePool.length === 0) return [];

    const bookingWhere: any = {
      orgId: org.id,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      startAt: { gte: dayStart, lte: dayEnd },
    };

    // If specific staff selected → only their bookings
    // If no preference → get ALL staff bookings
    if (staffId) {
      bookingWhere.userId = staffId;
    }

    const existingBookings = await this.prisma.db.booking.findMany({
      where: bookingWhere,
      select: { startAt: true, endAt: true, userId: true },
    });

    // Step 5: Generate all possible time slots
    const slotDuration = service.durationMins;
    const buffer = service.buffer || org.bufferMins || 0;

    // Parse working hours: "09:00" → minutes from midnight
    const [openH, openM] = hours.openTime.split(':').map(Number);
    const [closeH, closeM] = hours.closeTime.split(':').map(Number);
    const openMins = openH * 60 + openM; // 09:00 → 540
    const closeMins = closeH * 60 + closeM; // 18:00 → 1080

    const allSlots: string[] = [];

    for (let mins = openMins; mins + slotDuration <= closeMins; mins += 30) {
      const hour = Math.floor(mins / 60);
      const minute = mins % 60;
      const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      allSlots.push(timeStr);
    }

    // ── Step 6: Remove slots that conflict with bookings ─
    const availableSlots = allSlots.filter((slot) => {
      const [slotH, slotM] = slot.split(':').map(Number);
      const slotStart = slotH * 60 + slotM;
      const slotEnd = slotStart + slotDuration + buffer;

      if (staffId) {
        const hasConflict = existingBookings.some((booking) => {
          const bStart = toZonedTime(booking.startAt, orgTz);
          const bEnd = toZonedTime(booking.endAt, orgTz);
          const bookingStart = bStart.getHours() * 60 + bStart.getMinutes();
          const bookingEnd = bEnd.getHours() * 60 + bEnd.getMinutes() + buffer;
          return slotStart < bookingEnd && slotEnd > bookingStart;
        });
        return !hasConflict;
      }

      const overlap = existingBookings.filter((b) => {
        const bStart = toZonedTime(b.startAt, orgTz);
        const bEnd = toZonedTime(b.endAt, orgTz);
        const bookingStart = bStart.getHours() * 60 + bStart.getMinutes();
        const bookingEnd = bEnd.getHours() * 60 + bEnd.getMinutes() + buffer;
        return slotStart < bookingEnd && slotEnd > bookingStart;
      });
      const busyStaffIds = new Set<string>();
      let unassignedOverlapCount = 0;
      for (const b of overlap) {
        if (b.userId && effectivePool.includes(b.userId))
          busyStaffIds.add(b.userId);
        else if (!b.userId) unassignedOverlapCount += 1;
      }
      const capacityUsed = busyStaffIds.size + unassignedOverlapCount;
      return capacityUsed < effectivePool.length;
    });

    // ── Step 7: Remove past slots if booking is today ───
    const nowInOrgTz = toZonedTime(new Date(), orgTz);
    const todayInOrgTz = `${nowInOrgTz.getFullYear()}-${String(nowInOrgTz.getMonth() + 1).padStart(2, '0')}-${String(nowInOrgTz.getDate()).padStart(2, '0')}`;

    let finalSlots = availableSlots;

    if (date === todayInOrgTz) {
      const currentMins = nowInOrgTz.getHours() * 60 + nowInOrgTz.getMinutes();
      const leadTime = org.minLeadTimeMins || 0;
      const minBookingTime = currentMins + leadTime;

      finalSlots = availableSlots.filter((slot) => {
        const [h, m] = slot.split(':').map(Number);
        return h * 60 + m >= minBookingTime;
      });
    }

    return finalSlots;
  }

  //POST /api/public/bookings
  async createPublicBooking(data: any) {
    // Find the org by slug
    const org = await this.prisma.db.organisation.findUnique({
      where: { slug: data.slug },
      include: { users: { where: { status: 'ACTIVE' }, select: { id: true } } },
    });

    if (!org || org.isDeleted) {
      throw new NotFoundException('Business not found');
    }

    const activeStaffIds = org.users.map((u) => u.id);
    if (activeStaffIds.length === 0) {
      throw new BadRequestException(
        'This business does not have any active staff to take bookings right now.',
      );
    }
    if (data.staffId && !activeStaffIds.includes(data.staffId)) {
      throw new BadRequestException(
        'The requested staff member is no longer available.',
      );
    }

    // Verify service belongs to this org
    const service = await this.prisma.db.service.findUnique({
      where: { id: data.serviceId },
    });

    if (!service || service.orgId !== org.id || service.isDeleted) {
      throw new NotFoundException('Service not found');
    }

    // Build startAt/endAt from org-local date+time strings
    const orgTz = org.timezone || 'UTC';
    const startAt = fromZonedTime(`${data.date}T${data.time}:00`, orgTz);
    const endAt = new Date(startAt.getTime() + service.durationMins * 60000);

    // Tier cap — public bookings count against the org's monthly limit
    const cap = TIER_LIMITS[org.planTier].bookingsPerMonth;
    if (cap !== UNLIMITED) {
      const bookingsThisMonth = await this.prisma.db.booking.count({
        where: {
          orgId: org.id,
          createdAt: { gte: startOfMonth(new Date()) },
        },
      });
      if (bookingsThisMonth >= cap) {
        throw new BadRequestException(
          'This business is not accepting online bookings at the moment. Please contact them directly to schedule.',
        );
      }
    }

    const booking = await this.prisma.db
      .$transaction(async (tx) => {
        const dayStartUtc = fromZonedTime(`${data.date}T00:00:00`, orgTz);
        const dayEndUtc = fromZonedTime(`${data.date}T23:59:59.999`, orgTz);

        const onLeave = await tx.staffLeave.findMany({
          where: {
            orgId: org.id,
            userId: { in: activeStaffIds },
            status: { in: ['PENDING', 'APPROVED'] },
            startDate: { lt: dayEndUtc },
            endDate: { gt: dayStartUtc },
          },
          select: { userId: true },
        });
        const onLeaveIds = new Set(onLeave.map((l) => l.userId));
        const effectivePool = activeStaffIds.filter(
          (id) => !onLeaveIds.has(id),
        );

        let finalStaffId: string | null;

        if (data.staffId) {
          if (onLeaveIds.has(data.staffId)) {
            throw new BadRequestException(
              'The requested staff member is on leave on the selected date.',
            );
          }

          const conflict = await tx.booking.findFirst({
            where: {
              orgId: org.id,
              userId: data.staffId,
              status: { notIn: ['CANCELLED', 'NO_SHOW'] },
              startAt: { lt: endAt },
              endAt: { gt: startAt },
            },
          });
          if (conflict) {
            throw new BadRequestException(
              'This time slot is no longer available. Please select another time.',
            );
          }

          finalStaffId = data.staffId;
        } else {
          const overlap = await tx.booking.findMany({
            where: {
              orgId: org.id,
              status: { notIn: ['CANCELLED', 'NO_SHOW'] },
              startAt: { lt: endAt },
              endAt: { gt: startAt },
            },
            select: { userId: true },
          });
          const busyStaffIds = new Set<string>();
          let unassignedOverlapCount = 0;
          for (const b of overlap) {
            if (b.userId && effectivePool.includes(b.userId))
              busyStaffIds.add(b.userId);
            else if (!b.userId) unassignedOverlapCount += 1;
          }
          const capacityUsed = busyStaffIds.size + unassignedOverlapCount;
          if (capacityUsed >= effectivePool.length) {
            throw new BadRequestException(
              'This time slot is no longer available. Please select another time.',
            );
          }

          finalStaffId = effectivePool.length === 1 ? effectivePool[0] : null;
        }

        // Find or create customer
        let customer = await tx.customer.findFirst({
          where: {
            email: data.customer.email,
            orgId: org.id,
          },
        });

        if (customer) {
          // Update name and phone in case they changed
          customer = await tx.customer.update({
            where: { id: customer.id },
            data: {
              name: data.customer.name,
              phone: data.customer.phone,
            },
          });
        } else {
          // New customer
          customer = await tx.customer.create({
            data: {
              name: data.customer.name,
              email: data.customer.email,
              phone: data.customer.phone,
              orgId: org.id,
            },
          });
        }

        // Create booking
        const newBooking = await tx.booking.create({
          data: {
            startAt,
            endAt,
            source: 'MANUAL_CUSTOMER',
            status: 'PENDING',
            note: data.note || null,
            customerId: customer.id,
            serviceId: data.serviceId,
            userId: finalStaffId,
            orgId: org.id,
          },
          include: {
            user: true,
          },
        });

        return newBooking;
      })
      .catch((err: any) => {
        if (String(err?.message ?? '').includes('23P01')) {
          throw new BadRequestException(
            'This time slot is no longer available. Please select another time.',
          );
        }
        throw err;
      });

    await this.emailService.sendBookingConfirmationEmail(
      data.customer.email,
      data.customer.name,
      org.name,
      service.name,
      booking.user
        ? `${booking.user.firstName} ${booking.user.lastName}`
        : null,
      booking.startAt.toLocaleDateString('en-US', { timeZone: orgTz }),
      booking.startAt.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: orgTz,
      }),
    );

    await this.notificationService.notifyOrgAdmins(
      org.id,
      'New Booking',
      `${data.customer.name} booked ${service.name}`,
      'BOOKING',
      'BOOKING',
      booking.id,
    );

    await this.auditService.log({
      orgId: org.id,
      actorName: data.customer.name,
      action: 'BOOKING_CREATED',
      entityType: 'Booking',
      entityId: booking.id,
      metadata: { source: 'MANUAL_CUSTOMER', serviceName: service.name },
    });

    this.logger.log(`Public booking created: ${booking.id}`);

    return booking;
  }
}
