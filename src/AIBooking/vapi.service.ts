import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
      case 'tool-calls':
        return await this.handleToolCalls(message);

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
  private async handleToolCalls(message: any) {
    const toolCalls = message.toolCallList || [];

    const callId = message.call?.id;

    // Process each tool call in the array
    // (usually just 1, but Vapi allows batching)
    const results = await Promise.all(
      toolCalls.map(async (call: any) => {
        const { id, function: fn } = call;
        const { name, arguments: args } = fn;

        this.logger.log(`Vapi tool: ${name}`);

        // Route to handler — returns plain data (no { result: ... } wrapper)
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
            default:
              this.logger.warn(`Unknown tool: ${name}`);
              result = { error: 'Unknown tool' };
          }
        } catch (err) {
          this.logger.error(`Tool ${name} failed: ${(err as Error).message}`);
          result = { error: 'Internal error processing request' };
        }

        return {
          toolCallId: id,
          result: JSON.stringify(result), // Vapi expects string result
        };
      }),
    );

    return { results };
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

    if (org.planTier === 'STARTER') {
      return {
        error:
          'Voice booking is not available for this business. Please book manually instead.',
      };
    }
    // Format for the AI to read naturally
    // AI will say: "We offer Haircut for $35, takes 30 minutes..."
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
        slots: [],
        message: 'Business is closed on this day',
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
      slots: finalSlots,
      message:
        finalSlots.length > 0
          ? `Available times: ${finalSlots.join(', ')}`
          : 'No available slots for this date',
    };
  }

  // ── Function 3: Create booking
  // AI calls this after collecting all customer details.
  // Creates customer (or finds existing) + creates booking.
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
          voiceCallId: callId || null,
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
      success: true,
      bookingId: booking.id,
      message: `Booking confirmed! ${params.customerName} is booked for ${service.name} on ${startAt.toLocaleDateString()} at ${startAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
    };
  }

  // ── End of call report
  // Vapi sends this AFTER the conversation ends.
  // Contains the full transcript and call duration.
  // We find the booking created during this call
  // and save the transcript for reporting.
  private async handleEndOfCallReport(message: any) {
    // Vapi payload shape (verify these field paths against actual logs later)
    const callId = message.call?.id;
    const durationSeconds = message.durationSeconds || 0;
    const transcript = message.transcript;
    const endedReason = message.endedReason;

    // The slug was passed when the call started (assistantOverrides.variableValues)
    // Vapi echoes it back in the call object
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

    // 1. Find the org so we have orgId
    const org = await this.prisma.db.organisation.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!org) {
      this.logger.warn(`Call ${callId} for unknown slug: ${slug}`);
      return;
    }

    // 2. Insert VoiceUsage — catch duplicate-callId errors (Vapi retry)
    try {
      await this.prisma.db.voiceUsage.create({
        data: {
          callId,
          duration: durationSeconds,
          orgId: org.id,
        },
      });
      this.logger.log(
        `Voice usage tracked: org=${org.id} callId=${callId} duration=${durationSeconds}s`,
      );
    } catch (err) {
      // P2002 = Prisma unique constraint violation — Vapi retried the webhook
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

    // 3. Save transcript on the booking (existing logic, improved with callId)
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
