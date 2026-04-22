import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../generated/prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { NotificationService } from '../notifications/notifications.service.js';

@Injectable()
export class VapiService {
  private readonly logger = new Logger(VapiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
  ) {}

  // ── Main webhook handler
  // Vapi sends different message types to this endpoint.
  // We route each type to the correct handler.
  async handleWebhook(body: any) {
    const { message } = body;

    switch (message?.type) {
      // AI needs to call one of our functions
      // (getServices, getAvailableSlots, createBooking)
      case 'function-call':
        return await this.handleFunctionCall(message);

      // Conversation ended — Vapi sends a full report
      // Contains transcript, duration, summary
      case 'end-of-call-report':
        await this.handleEndOfCallReport(message);
        return {};

      // Other types: status-update, transcript, etc
      // We log them but don't process
      default:
        this.logger.log(`Vapi message: ${message?.type}`);
        return {};
    }
  }

  // ── Route function calls to the correct handler
  // Vapi AI decides which function to call based on
  // the conversation. We defined these functions when
  // creating the assistant (next step).
  private async handleFunctionCall(message: any) {
    const { functionCall } = message;
    const { name, parameters } = functionCall;

    this.logger.log(`Vapi function: ${name}`);

    switch (name) {
      case 'getServices':
        return await this.getServices(parameters);

      case 'getAvailableSlots':
        return await this.getAvailableSlots(parameters);

      case 'createBooking':
        return await this.createBooking(parameters);

      default:
        this.logger.warn(`Unknown function: ${name}`);
        return { error: 'Unknown function' };
    }
  }

  // ── Function 1: Get services for the org
  // AI calls this when customer asks "what services do you have?"
  // Returns a list of services the AI reads to the customer.
  private async getServices(params: { slug: string }) {
    const org = await this.prisma.db.organisation.findUnique({
      where: { slug: params.slug },
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

    if (!org || org.isDeleted) {
      return { error: 'Business not found' };
    }

    // Format for the AI to read naturally
    // AI will say: "We offer Haircut for $35, takes 30 minutes..."
    return {
      result: {
        services: org.services.map((s) => ({
          id: s.id,
          name: s.name,
          duration: `${s.durationMins} minutes`,
          price: s.price,
          description: s.description || '',
        })),
      },
    };
  }

  // ── Function 2: Get available time slots ────────────
  // AI calls this when customer picks a service and date.
  // Same slot calculation logic as public-booking service.
  private async getAvailableSlots(params: {
    slug: string;
    serviceId: string;
    date: string;
    staffId?: string;
  }) {
    // Step 1: Get org and working hours
    const org = await this.prisma.db.organisation.findUnique({
      where: { slug: params.slug },
      include: { workingHours: true },
    });

    if (!org || org.isDeleted) {
      return { error: 'Business not found' };
    }

    // Step 2: Get the service (need duration for slot size)
    const service = await this.prisma.db.service.findUnique({
      where: { id: params.serviceId },
    });

    if (!service || service.orgId !== org.id) {
      return { error: 'Service not found' };
    }

    // Step 3: Which day of the week is this date?
    const bookingDate = new Date(params.date);
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayOfWeek = dayNames[bookingDate.getDay()];

    // Find working hours for this day
    const hours = org.workingHours.find((h) => h.day === dayOfWeek);

    if (!hours || !hours.isOpen) {
      return {
        result: { slots: [], message: 'Business is closed on this day' },
      };
    }

    // Step 4: Get existing bookings for that day
    // Only PENDING and CONFIRMED block slots
    const dayStart = new Date(params.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(params.date);
    dayEnd.setHours(23, 59, 59, 999);

    const bookingWhere: any = {
      orgId: org.id,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { gte: dayStart, lte: dayEnd },
    };

    if (params.staffId) {
      bookingWhere.userId = params.staffId;
    }

    const existingBookings = await this.prisma.db.booking.findMany({
      where: bookingWhere,
    });

    // Step 5: Generate all possible slots
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

    // Step 6: Remove slots that conflict with existing bookings
    const availableSlots = allSlots.filter((slot) => {
      const [slotH, slotM] = slot.split(':').map(Number);
      const slotStart = slotH * 60 + slotM;
      const slotEnd = slotStart + slotDuration + buffer;

      const hasConflict = existingBookings.some((booking) => {
        const bookingStart =
          booking.startAt.getHours() * 60 + booking.startAt.getMinutes();
        const bookingEnd =
          booking.endAt.getHours() * 60 + booking.endAt.getMinutes() + buffer;
        return slotStart < bookingEnd && slotEnd > bookingStart;
      });

      return !hasConflict;
    });

    // Step 7: Remove past slots if booking is for today
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const requestDate = bookingDate.toISOString().split('T')[0];

    let finalSlots = availableSlots;

    if (requestDate === today) {
      const currentMins = now.getHours() * 60 + now.getMinutes();
      const leadTime = org.minLeadTimeMins || 0;
      const minBookingTime = currentMins + leadTime;

      finalSlots = availableSlots.filter((slot) => {
        const [h, m] = slot.split(':').map(Number);
        return h * 60 + m >= minBookingTime;
      });
    }

    // Return formatted for the AI to read
    return {
      result: {
        slots: finalSlots,
        message:
          finalSlots.length > 0
            ? `Available times: ${finalSlots.join(', ')}`
            : 'No available slots for this date',
      },
    };
  }

  // ── Function 3: Create booking
  // AI calls this after collecting all customer details.
  // Creates customer (or finds existing) + creates booking.
  private async createBooking(params: {
    slug: string;
    serviceId: string;
    date: string;
    time: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    staffId?: string;
    note?: string;
  }) {
    const org = await this.prisma.db.organisation.findUnique({
      where: { slug: params.slug },
    });

    if (!org || org.isDeleted) {
      return { error: 'Business not found' };
    }

    const service = await this.prisma.db.service.findUnique({
      where: { id: params.serviceId },
    });

    if (!service || service.orgId !== org.id) {
      return { error: 'Service not found' };
    }

    // Calculate start and end times from "10:00" + duration
    const [hour, minute] = params.time.split(':').map(Number);
    const startAt = new Date(params.date);
    startAt.setHours(hour, minute, 0, 0);

    const endAt = new Date(startAt);
    endAt.setMinutes(endAt.getMinutes() + service.durationMins);

    const booking = await this.prisma.db.$transaction(async (tx) => {
      // Find or create customer (same pattern as public booking)
      let customer = await tx.customer.findFirst({
        where: { email: params.customerEmail, orgId: org.id },
      });

      if (customer) {
        customer = await tx.customer.update({
          where: { id: customer.id },
          data: {
            name: params.customerName,
            phone: params.customerPhone,
          },
        });
      } else {
        customer = await tx.customer.create({
          data: {
            name: params.customerName,
            email: params.customerEmail,
            phone: params.customerPhone,
            orgId: org.id,
          },
        });
      }

      // Create booking with VOICE_AI source
      const newBooking = await tx.booking.create({
        data: {
          startAt,
          endAt,
          source: 'VOICE_AI',
          status: 'PENDING',
          note: params.note || null,
          customerId: customer.id,
          serviceId: params.serviceId,
          userId: params.staffId || null,
          orgId: org.id,
        },
        include: { user: true },
      });

      return newBooking;
    });

    // Send confirmation email to customer
    await this.emailService.sendBookingConfirmationEmail(
      params.customerEmail,
      params.customerName,
      org.name,
      service.name,
      booking.user
        ? `${booking.user.firstName} ${booking.user.lastName}`
        : null,
      startAt.toLocaleDateString(),
      startAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    );

    await this.notificationService.notifyOrgAdmins(
      org.id,
      'New Voice Booking',
      `${params.customerName} booked ${service.name} via AI`,
      'BOOKING',
      'BOOKING',
      booking.id,
    );

    this.logger.log(`Voice AI booking created: ${booking.id}`);

    // Return message for AI to read to customer
    return {
      result: {
        success: true,
        bookingId: booking.id,
        message: `Booking confirmed! ${params.customerName} is booked for ${service.name} on ${startAt.toLocaleDateString()} at ${startAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
      },
    };
  }

  // ── End of call report
  // Vapi sends this AFTER the conversation ends.
  // Contains the full transcript and call duration.
  // We find the booking created during this call
  // and save the transcript for reporting.
  private async handleEndOfCallReport(message: any) {
    const { transcript, summary, endedReason, durationSeconds } = message;

    this.logger.log(
      `Call ended. Duration: ${durationSeconds}s. Reason: ${endedReason}`,
    );

    // transcript is the full conversation text:
    // "AI: Hi, welcome to Glow Beauty!\nUser: I'd like to book a haircut\n..."

    if (!transcript) {
      this.logger.warn('No transcript in end-of-call report');
      return;
    }

    // Find the most recent VOICE_AI booking (created in last 5 minutes)
    // This links the transcript to the booking that was just made
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const recentBooking = await this.prisma.db.booking.findFirst({
      where: {
        source: 'VOICE_AI',
        createdAt: { gte: fiveMinutesAgo },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentBooking) {
      // Save transcript and duration on the booking
      await this.prisma.db.booking.update({
        where: { id: recentBooking.id },
        data: {
          voiceTranscript: transcript,
          voiceDuration: durationSeconds || null,
        },
      });

      this.logger.log(`Transcript saved for booking: ${recentBooking.id}`);
    } else {
      // Conversation happened but no booking was made
      // Customer might have just asked questions and left
      this.logger.log(
        'No booking found for this call — customer may have disconnected',
      );
    }
  }
}
