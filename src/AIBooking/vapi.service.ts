import { Injectable, Logger } from '@nestjs/common';
import { startOfMonth } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../email/email.service.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  TIER_LIMITS,
  UNLIMITED,
} from '../common/constants/tier-limits.constant.js';

@Injectable()
export class VapiService {
  private readonly logger = new Logger(VapiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
  ) {}

  // Main webhook handler
  async handleWebhook(body: any) {
    const { message } = body;
    switch (message?.type) {
      case 'tool-calls':
        return await this.handleToolCalls(message);
      case 'end-of-call-report':
        await this.handleEndOfCallReport(message);
        return {};
      default:
        this.logger.log(`Vapi message: ${message?.type}`);
        return {};
    }
  }

  // Route function calls to the correct handler
  private async handleToolCalls(message: any) {
    const toolCalls = message.toolCallList || [];
    const callId = message.call?.id;
    const results = await Promise.all(
      toolCalls.map(async (call: any) => {
        const { id, function: fn } = call;
        const { name, arguments: args } = fn;
        this.logger.log(`Vapi tool: ${name}`);
        let result: any;
        try {
          switch (name) {
            case 'getServices':
              result = await this.getServices(args);
              break;
            case 'getAvailableSlots':
              result = await this.getAvailableSlots(args);
              break;
            case 'createBooking':
              result = await this.createBooking(args, callId);
              break;
            case 'getStaff':
              result = await this.getStaff(args);
              break;
            default:
              this.logger.warn(`Unknown tool: ${name}`);
              result = { error: 'Unknown tool' };
          }
        } catch (err) {
          this.logger.error(`Tool ${name} failed: ${(err as Error).message}`);
          result = { error: 'Internal error processing request' };
        }
        return { toolCallId: id, result: JSON.stringify(result) };
      }),
    );
    return { results };
  }

  // Resolves a service by id first, then falls back to matching by name
  // within the org. Handles the case where the LLM passes the service NAME
  // (e.g. "haircut") instead of the cuid id.
  private async resolveService(serviceIdOrName: string, orgId: string) {
    // Try by id first (the happy path)
    const byId = await this.prisma.db.service.findUnique({
      where: { id: serviceIdOrName },
    });
    if (byId && byId.orgId === orgId && !byId.isDeleted) return byId;

    // Fallback: case-insensitive name match within the org
    const byName = await this.prisma.db.service.findFirst({
      where: {
        orgId,
        isActive: true,
        isDeleted: false,
        name: { equals: serviceIdOrName, mode: 'insensitive' },
      },
    });
    return byName || null;
  }

  // Function 1: Get services for the org
  private async getServices(params: { slug: string }) {
    const slug = params.slug?.trim();
    if (!slug) {
      return {
        error: 'Missing slug parameter. Always pass slug in tool calls.',
      };
    }
    const org = await this.prisma.db.organisation.findUnique({
      where: { slug },
      include: {
        services: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            durationMins: true,
            price: true,
            description: true,
          },
        },
      },
    });
    if (!org || org.isDeleted) return { error: 'Business not found' };
    if (org.planTier === 'STARTER' || !org.voiceAiEnabled) {
      return {
        error:
          'Voice booking is not available for this business. Please book manually instead.',
      };
    }
    return {
      services: org.services.map((s) => ({
        id: s.id,
        name: s.name,
        duration: `${s.durationMins} minutes`,
        price: s.price,
        description: s.description || '',
      })),
    };
  }

  // Function 2: Get available time slots
  // A slot is available if at least one active staff is free at that time.
  // Slot is removed only when ALL active staff are busy at that time.
  private async getAvailableSlots(params: {
    slug: string;
    serviceId: string;
    date: string;
    staffId?: string;
  }) {
    const slug = params.slug?.trim();
    const date = params.date?.trim();
    const serviceId = params.serviceId?.trim();
    const staffId = params.staffId?.trim();
    if (!slug)
      return {
        error: 'Missing slug parameter. Always pass slug in tool calls.',
      };
    if (!date)
      return {
        error: 'Missing date parameter. Ask the customer which day they want.',
      };
    if (!serviceId) {
      return {
        error:
          'Service not found or not selected yet. Ask the customer which service they want to book BEFORE checking time slots.',
      };
    }

    const org = await this.prisma.db.organisation.findUnique({
      where: { slug },
      include: {
        workingHours: { where: { userId: null } },
        users: { where: { status: 'ACTIVE' }, select: { id: true } },
      },
    });
    if (!org || org.isDeleted) return { error: 'Business not found' };

    const activeStaffIds = org.users.map((u) => u.id);

    const service = await this.resolveService(serviceId, org.id);
    if (!service) return { error: 'Service not found' };

    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    // Parse date string components directly to get correct weekday regardless of server TZ
    const [yr, mo, dy] = date.split('-').map(Number);
    const dayOfWeek = dayNames[new Date(yr, mo - 1, dy).getDay()];
    const hours = org.workingHours.find((h) => h.day === dayOfWeek);
    if (!hours || !hours.isOpen) {
      return {
        slots: [],
        reason: 'CLOSED',
        message: `The business is closed on ${dayOfWeek}s. Offer the customer a different day.`,
      };
    }

    const orgTz = org.timezone || 'UTC';
    // const dayStart = new Date(date);
    // dayStart.setHours(0, 0, 0, 0);
    // const dayEnd = new Date(date);
    // dayEnd.setHours(23, 59, 59, 999);
    // Local day → UTC bounds, so we fetch the right day's bookings.
    const dayStart = fromZonedTime(`${date}T00:00:00`, orgTz);
    const dayEnd = fromZonedTime(`${date}T23:59:59`, orgTz);

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
    const onLeaveIds = new Set(onLeave.map(l => l.userId));
    const effectivePool = activeStaffIds.filter(id => !onLeaveIds.has(id));

    if (staffId && onLeaveIds.has(staffId)) {
      return {
        slots: [],
        reason: 'STAFF_ON_LEAVE',
        message: 'That staff member is on leave that day. Offer the customer another staff member or another day.',
      };
    }
    if (!staffId && effectivePool.length === 0) {
      return {
        slots: [],
        reason: 'NO_STAFF_AVAILABLE',
        message: 'No staff are available on this day. Offer the customer another day.',
      };
    }

    const bookingWhere: any = {
      orgId: org.id,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      startAt: { gte: dayStart, lte: dayEnd },
    };
    if (staffId) bookingWhere.userId = staffId;

    const existingBookings = await this.prisma.db.booking.findMany({
      where: bookingWhere,
      select: { startAt: true, endAt: true, userId: true },
    });

    const slotDuration = service.durationMins;
    const buffer = service.buffer || org.bufferMins || 0;
    const [openH, openM] = hours.openTime.split(':').map(Number);
    const [closeH, closeM] = hours.closeTime.split(':').map(Number);
    const openMins = openH * 60 + openM;
    const closeMins = closeH * 60 + closeM;

    const allSlots: string[] = [];
    for (let mins = openMins; mins + slotDuration <= closeMins; mins += 30) {
      const hour = Math.floor(mins / 60);
      const minute = mins % 60;
      allSlots.push(
        `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
      );
    }

    // For each slot, determine availability based on capacity
    const availableSlots = allSlots.filter((slot) => {
      const [slotH, slotM] = slot.split(':').map(Number);
      const slotStart = slotH * 60 + slotM;
      const slotEnd = slotStart + slotDuration + buffer;

      const overlappingBookings = existingBookings.filter((booking) => {
        // const bookingStart =
        //   booking.startAt.getHours() * 60 + booking.startAt.getMinutes();
        // const bookingEnd =
        //   booking.endAt.getHours() * 60 + booking.endAt.getMinutes() + buffer;
        // Stored times are UTC; view them in the org tz before comparing to local slots.
        const bStart = toZonedTime(booking.startAt, orgTz);
        const bEnd = toZonedTime(booking.endAt, orgTz);
        const bookingStart = bStart.getHours() * 60 + bStart.getMinutes();
        const bookingEnd = bEnd.getHours() * 60 + bEnd.getMinutes() + buffer;
        return slotStart < bookingEnd && slotEnd > bookingStart;
      });

      // Case 1: Specific staff requested → check only that staff's overlap
      if (staffId) {
        return overlappingBookings.length === 0;
      }

      // Case 2: No specific staff → check overall capacity
      if (effectivePool.length === 0) return false;

      // Count distinct busy active staff + unassigned bookings (they also consume capacity)
      const busyStaffIds = new Set<string>();
      let unassignedOverlapCount = 0;
      for (const booking of overlappingBookings) {
        if (booking.userId && effectivePool.includes(booking.userId)) {
          busyStaffIds.add(booking.userId);
        } else if (!booking.userId) {
          unassignedOverlapCount += 1;
        }
      }
      const capacityUsed = busyStaffIds.size + unassignedOverlapCount;
      return capacityUsed < effectivePool.length;
    });

    // Remove past slots if booking is for today (computed in the ORG's timezone)

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

    if (finalSlots.length === 0) {
      return {
        slots: [],
        reason: 'FULLY_BOOKED',
        message:
          'The business is open this day but all slots are taken. Offer the customer a different day.',
      };
    }

    // Convert each slot to natural spoken form for the LLM to read aloud
    // e.g. "09:00" → "nine in the morning", "13:30" → "one-thirty in the afternoon"
    const toSpoken = (slot: string): string => {
      const [h, m] = slot.split(':').map(Number);
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const hourWords: Record<number, string> = {
        1: 'one',
        2: 'two',
        3: 'three',
        4: 'four',
        5: 'five',
        6: 'six',
        7: 'seven',
        8: 'eight',
        9: 'nine',
        10: 'ten',
        11: 'eleven',
        12: 'twelve',
      };
      const minuteWord = m === 0 ? '' : m === 30 ? '-thirty' : ` ${m}`;
      let period: string;
      if (h === 12 && m === 0) return 'noon';
      if (h === 0 && m === 0) return 'midnight';
      if (h < 12) period = 'in the morning';
      else if (h < 17) period = 'in the afternoon';
      else period = 'in the evening';
      return `${hourWords[hour12]}${minuteWord} ${period}`;
    };

    return {
      slots: finalSlots,
      slotsSpoken: finalSlots.map(toSpoken),
      reason: 'AVAILABLE',
      message: `Available times (use slotsSpoken when reading aloud): ${finalSlots.map(toSpoken).join(', ')}`,
    };
  }

  // Function 3: Create booking
  // Assignment logic:
  //   - staffId passed → verify free, assign (race condition → REQUESTED_STAFF_TAKEN)
  //   - no staffId + org has 1 active staff → auto-assign to that staff
  //   - no staffId + org has 2+ active staff → leave userId null (admin assigns)
  //   - no staffId + org has 0 active staff → reject
  //   - slot rejected if all capacity consumed → SLOT_TAKEN
  private async createBooking(
    params: {
      slug: string;
      serviceId: string;
      date: string;
      time: string;
      customerName: string;
      customerEmail: string;
      customerPhone: string;
      staffId?: string;
      note?: string;
    },
    callId?: string,
  ) {
    const slug = params.slug?.trim();
    const date = params.date?.trim();
    const time = params.time?.trim();
    const serviceId = params.serviceId?.trim();
    const requestedStaffId = params.staffId?.trim();
    const customerName = params.customerName?.trim();
    const customerEmail = params.customerEmail?.trim();
    const customerPhone = params.customerPhone?.trim();
    const note = params.note?.trim();

    if (!slug)
      return {
        error: 'Missing slug parameter. Always pass slug in tool calls.',
      };
    if (!date)
      return {
        error: 'Missing date parameter. Ask the customer which day they want.',
      };
    if (!time)
      return {
        error: 'Missing time parameter. Ask the customer what time they want.',
      };
    if (!serviceId) {
      return {
        error:
          'Service not found or not selected yet. Ask the customer which service they want to book first.',
      };
    }
    if (!customerName) {
      return {
        error:
          'Missing customer name. Please ask the customer for their name before booking.',
      };
    }
    if (!customerEmail) {
      return {
        error:
          'Missing customer email. Please ask the customer for their email before booking.',
      };
    }
    if (!customerPhone) {
      return {
        error:
          'Missing customer phone. Please ask the customer for their phone number before booking.',
      };
    }
    if (!customerEmail.includes('@')) {
      return {
        error:
          'Customer email looks invalid. Please confirm the email with the customer.',
      };
    }

    const org = await this.prisma.db.organisation.findUnique({
      where: { slug },
      include: { users: { where: { status: 'ACTIVE' }, select: { id: true } } },
    });
    if (!org || org.isDeleted) return { error: 'Business not found' };
    if (org.planTier === 'STARTER' || !org.voiceAiEnabled) {
      return {
        error:
          'Voice booking is not available for this business. Please book manually instead.',
      };
    }

    const activeStaffIds = org.users.map((u) => u.id);

    if (activeStaffIds.length === 0) {
      return {
        error:
          'This business does not have any active staff to take bookings right now. Please contact them directly.',
      };
    }

    // If staff was requested, verify they exist and are active in this org
    if (requestedStaffId && !activeStaffIds.includes(requestedStaffId)) {
      return {
        error:
          'The requested staff member is no longer available. Please ask the customer to pick again or try another time.',
      };
    }

    const cap = TIER_LIMITS[org.planTier].bookingsPerMonth;
    if (cap !== UNLIMITED) {
      const bookingsThisMonth = await this.prisma.db.booking.count({
        where: { orgId: org.id, createdAt: { gte: startOfMonth(new Date()) } },
      });
      if (bookingsThisMonth >= cap) {
        return {
          error:
            'This business is not accepting online bookings at the moment. Please contact them directly to schedule.',
        };
      }
    }

    const service = await this.resolveService(serviceId, org.id);
    if (!service) return { error: 'Service not found' };

    const [hour, minute] = time.split(':').map(Number);
    // const startAt = new Date(date);
    // startAt.setHours(hour, minute, 0, 0);
    // const endAt = new Date(startAt);
    // endAt.setMinutes(endAt.getMinutes() + service.durationMins);

    // // ── Validate booking falls within business working hours
    // const workingHours = await this.prisma.db.workingHour.findMany({
    //   where: { orgId: org.id },
    // });
    // const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    // const dayOfWeek = dayNames[startAt.getDay()];
    // const dayHours = workingHours.find((h) => h.day === dayOfWeek);
    const orgTz = org.timezone || 'UTC';

    // date/time are LOCAL wall-clock in the org's timezone.
    // Convert to the correct UTC instant for storage.
    const startAt = fromZonedTime(`${date}T${time}:00`, orgTz); // "2026-06-01T14:00:00" @ Colombo → 08:30Z
    const endAt = new Date(startAt.getTime() + service.durationMins * 60000);

    // ── Validate against working hours
    const workingHours = await this.prisma.db.workingHour.findMany({
      where: { orgId: org.id, userId: null },
    });
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    // Weekday from the date string, not the UTC Date — so it's the LOCAL calendar day.
    const [yr, mo, dy] = date.split('-').map(Number);
    const dayOfWeek = dayNames[new Date(yr, mo - 1, dy).getDay()];
    const dayHours = workingHours.find((h) => h.day === dayOfWeek);

    if (!dayHours || !dayHours.isOpen) {
      return {
        error: `The business is closed on ${dayOfWeek}s. Please offer the customer another day.`,
      };
    }

    const [openH, openM] = dayHours.openTime.split(':').map(Number);
    const [closeH, closeM] = dayHours.closeTime.split(':').map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;
    // const bookingStartMinutes = startAt.getHours() * 60 + startAt.getMinutes();
    // const bookingEndMinutes = endAt.getHours() * 60 + endAt.getMinutes();
    //The caller's LOCAL wall-clock vs local open/close. Don't read .getHours()
    // off startAt — on a UTC server that's the UTC hour (08:30), not 14:00.
    const bookingStartMinutes = hour * 60 + minute;
    const bookingEndMinutes = bookingStartMinutes + service.durationMins;

    if (bookingStartMinutes < openMinutes || bookingEndMinutes > closeMinutes) {
      return {
        error: `The booking time is outside business hours (open ${dayHours.openTime} to ${dayHours.closeTime}). Please offer the customer a time within open hours.`,
      };
    }

    const buffer = service.buffer || org.bufferMins || 0;
    const bufferedStart = new Date(startAt.getTime() - buffer * 60000);
    const bufferedEnd = new Date(endAt.getTime() + buffer * 60000);

    let booking: any;
    try {
      booking = await this.prisma.db.$transaction(async (tx) => {
        const dayStartUtc = fromZonedTime(`${date}T00:00:00`, orgTz);
        const dayEndUtc = fromZonedTime(`${date}T23:59:59.999`, orgTz);

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
        const onLeaveIds = new Set(onLeave.map(l => l.userId));
        const effectivePool = activeStaffIds.filter(id => !onLeaveIds.has(id));

        const overlappingBookings = await tx.booking.findMany({
          where: {
            orgId: org.id,
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            startAt: { lt: bufferedEnd },
            endAt: { gt: bufferedStart },
          },
          select: { userId: true },
        });

        let finalStaffId: string | null = null;

        if (requestedStaffId) {
          if (onLeaveIds.has(requestedStaffId)) throw new Error('STAFF_ON_LEAVE');
          // Specific staff requested — verify they're still free
          const isBusy = overlappingBookings.some(
            (b) => b.userId === requestedStaffId,
          );
          if (isBusy) throw new Error('REQUESTED_STAFF_TAKEN');
          finalStaffId = requestedStaffId;
        } else {
          // No preference — check overall capacity
          const busyStaffIds = new Set<string>();
          let unassignedOverlapCount = 0;
          for (const b of overlappingBookings) {
            if (b.userId && effectivePool.includes(b.userId)) {
              busyStaffIds.add(b.userId);
            } else if (!b.userId) {
              unassignedOverlapCount += 1;
            }
          }
          const capacityUsed = busyStaffIds.size + unassignedOverlapCount;
          if (capacityUsed >= effectivePool.length) throw new Error('SLOT_TAKEN');

          // Single-staff org → auto-assign. Multi-staff → leave null for admin.
          finalStaffId = effectivePool.length === 1 ? effectivePool[0] : null;
        }

        // Find or create customer
        let customer = await tx.customer.findFirst({
          where: { email: customerEmail, orgId: org.id },
        });
        if (customer) {
          customer = await tx.customer.update({
            where: { id: customer.id },
            data: { name: customerName, phone: customerPhone },
          });
        } else {
          customer = await tx.customer.create({
            data: {
              name: customerName,
              email: customerEmail,
              phone: customerPhone,
              orgId: org.id,
            },
          });
        }

        const newBooking = await tx.booking.create({
          data: {
            startAt,
            endAt,
            source: 'VOICE_AI',
            status: 'PENDING',
            note: note || null,
            voiceCallId: callId || null,
            customerId: customer.id,
            serviceId: service.id,
            userId: finalStaffId,
            orgId: org.id,
          },
          include: { user: true },
        });

        return newBooking;
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'STAFF_ON_LEAVE') {
        return {
          error: 'The requested staff member is on leave that day. Please offer the customer another staff member or another day.',
        };
      }
      if (String(msg ?? '').includes('23P01')) {
        return {
          error:
            'This time slot is no longer available — all staff are booked then. Please pick another time.',
        };
      }
      if (msg === 'SLOT_TAKEN') {
        return {
          error:
            'This time slot is no longer available — all staff are booked then. Please pick another time.',
        };
      }
      if (msg === 'REQUESTED_STAFF_TAKEN') {
        return {
          error:
            'The requested staff member just got booked at that time. Please offer the customer another time or a different staff member.',
        };
      }
      throw err;
    }

    await this.emailService.sendBookingConfirmationEmail(
      customerEmail,
      customerName,
      org.name,
      service.name,
      booking.user
        ? `${booking.user.firstName} ${booking.user.lastName}`
        : null,
      // startAt.toLocaleDateString(),
      // startAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      startAt.toLocaleDateString('en-US', { timeZone: orgTz }),
      startAt.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: orgTz,
      }),
    );

    await this.notificationService.notifyOrgAdmins(
      org.id,
      'New Voice Booking',
      `${customerName} booked ${service.name} via AI`,
      'BOOKING',
      'BOOKING',
      booking.id,
    );

    await this.auditService.log({
      orgId: org.id,
      actorName: customerName,
      action: 'BOOKING_CREATED',
      entityType: 'Booking',
      entityId: booking.id,
      metadata: { source: 'VOICE_AI', serviceName: service.name },
    });

    this.logger.log(`Voice AI booking created: ${booking.id}`);

    return {
      success: true,
      bookingId: booking.id,
      message: `Booking confirmed! ${customerName} is booked for ${service.name} on ${startAt.toLocaleDateString('en-US', { timeZone: orgTz })} at ${startAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: orgTz })}.`,
    };
  }

  // Function 4: Get staff available at a specific date+time
  // Returns active staff free at the given time + activeStaffCount.
  // AI uses activeStaffCount to detect single-staff orgs and skip preference question.
  private async getStaff(params: {
    slug: string;
    date: string;
    time: string;
    serviceId: string;
  }) {
    const slug = params.slug?.trim();
    const date = params.date?.trim();
    const time = params.time?.trim();
    const serviceId = params.serviceId?.trim();

    if (!slug)
      return {
        error: 'Missing slug parameter. Always pass slug in tool calls.',
      };
    if (!date)
      return {
        error: 'Missing date parameter. Ask the customer which day they want.',
      };
    if (!time)
      return {
        error: 'Missing time parameter. Ask the customer what time they want.',
      };
    if (!serviceId) {
      return {
        error:
          'Cannot check staff without a confirmed service. Ask the customer which service first.',
      };
    }

    const org = await this.prisma.db.organisation.findUnique({
      where: { slug },
      include: {
        users: {
          where: { status: 'ACTIVE' },
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
    if (!org || org.isDeleted) return { error: 'Business not found' };
    if (org.planTier === 'STARTER' || !org.voiceAiEnabled) {
      return { error: 'Voice booking is not available for this business.' };
    }

    const service = await this.resolveService(serviceId, org.id);
    if (!service) {
      return {
        error:
          'Cannot check staff without a confirmed service. Ask the customer which service first.',
      };
    }

    // const [hour, minute] = time.split(':').map(Number);
    // const startAt = new Date(date);
    // startAt.setHours(hour, minute, 0, 0);
    // const endAt = new Date(startAt);
    // endAt.setMinutes(endAt.getMinutes() + service.durationMins);
    const orgTz = org.timezone || 'UTC';
    const startAt = fromZonedTime(`${date}T${time}:00`, orgTz);
    const endAt = new Date(startAt.getTime() + service.durationMins * 60000);

    const buffer = service.buffer || org.bufferMins || 0;
    const bufferedStart = new Date(startAt.getTime() - buffer * 60000);
    const bufferedEnd = new Date(endAt.getTime() + buffer * 60000);

    const dayStartUtc = fromZonedTime(`${date}T00:00:00`, orgTz);
    const dayEndUtc = fromZonedTime(`${date}T23:59:59.999`, orgTz);

    const onLeave = await this.prisma.db.staffLeave.findMany({
      where: {
        orgId: org.id,
        userId: { in: org.users.map(u => u.id) },
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lt: dayEndUtc },
        endDate: { gt: dayStartUtc },
      },
      select: { userId: true },
    });
    const onLeaveIds = new Set(onLeave.map(l => l.userId));
    const effectiveUsers = org.users.filter(u => !onLeaveIds.has(u.id));

    const conflictingBookings = await this.prisma.db.booking.findMany({
      where: {
        orgId: org.id,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        userId: { not: null },
        startAt: { lt: bufferedEnd },
        endAt: { gt: bufferedStart },
      },
      select: { userId: true },
    });

    const busyStaffIds = new Set(
      conflictingBookings.map((b) => b.userId).filter(Boolean),
    );

    const availableStaff = effectiveUsers
      .filter((u) => !busyStaffIds.has(u.id))
      .map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` }));

    // activeStaffCount = staff active AND not on leave that day.
    // The deployed Vapi prompt uses this as "1 = single staff, skip preference question",
    // which naturally adapts: if only 1 staff is effectively available, the AI auto-picks them.
    return {
      available: availableStaff,
      activeStaffCount: effectiveUsers.length,
      busyCount: effectiveUsers.length - availableStaff.length,
      message:
        availableStaff.length > 0
          ? `${availableStaff.length} of ${effectiveUsers.length} staff free at this time`
          : 'No staff available at this time',
    };
  }

  // End of call report
  private async handleEndOfCallReport(message: any) {
    const callId = message.call?.id;
    const durationSeconds = message.durationSeconds ?? null;
    const transcript = message.transcript;
    const endedReason = message.endedReason;
    const slug = message.call?.assistantOverrides?.variableValues?.slug;

    this.logger.log(
      `Call ${callId} ended. Duration: ${durationSeconds}s. Reason: ${endedReason}`,
    );

    if (!callId) {
      this.logger.warn(
        'end-of-call-report missing call.id — cannot track usage',
      );
      return;
    }
    if (!slug) {
      this.logger.warn(`Call ${callId} missing slug — cannot attribute usage`);
      return;
    }

    const org = await this.prisma.db.organisation.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!org) {
      this.logger.warn(`Call ${callId} for unknown slug: ${slug}`);
      return;
    }

    try {
      await this.prisma.db.voiceUsage.create({
        data: { callId, duration: durationSeconds ?? 0, orgId: org.id },
      });
      this.logger.log(
        `Voice usage tracked: org=${org.id} callId=${callId} duration=${durationSeconds}s`,
      );
    } catch (err) {
      if ((err as any).code === 'P2002') {
        this.logger.log(
          `Duplicate webhook for callId ${callId} — already tracked`,
        );
      } else {
        this.logger.error(
          `Failed to track voice usage: ${(err as Error).message}`,
        );
      }
    }

    if (transcript) {
      const booking = await this.prisma.db.booking.findFirst({
        where: { voiceCallId: callId },
      });
      if (booking) {
        await this.prisma.db.booking.update({
          where: { id: booking.id },
          data: {
            voiceTranscript: transcript,
            voiceDuration: durationSeconds || null,
          },
        });
        this.logger.log(`Transcript saved for booking: ${booking.id}`);
      } else {
        this.logger.log(
          `No booking for call ${callId} — minutes tracked, no transcript link`,
        );
      }
    }
  }
}
