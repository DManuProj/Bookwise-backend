// import { Injectable, Logger } from '@nestjs/common';
// import { startOfMonth } from 'date-fns';
// import { AuditService } from '../audit/audit.service.js';
// import { EmailService } from '../email/email.service.js';
// import { NotificationService } from '../notifications/notifications.service.js';
// import { PrismaService } from '../prisma/prisma.service.js';
// import {
//   TIER_LIMITS,
//   UNLIMITED,
// } from '../common/constants/tier-limits.constant.js';

// @Injectable()
// export class VapiService {
//   private readonly logger = new Logger(VapiService.name);

//   constructor(
//     private readonly prisma: PrismaService,
//     private readonly emailService: EmailService,
//     private readonly notificationService: NotificationService,
//     private readonly auditService: AuditService,
//   ) {}

//   // ── Main webhook handler
//   // Vapi sends different message types to this endpoint.
//   // We route each type to the correct handler.
//   async handleWebhook(body: any) {
//     const { message } = body;

//     switch (message?.type) {
//       // AI needs to call one of our functions
//       // (getServices, getAvailableSlots, createBooking)
//       case 'tool-calls':
//         return await this.handleToolCalls(message);

//       // Conversation ended — Vapi sends a full report
//       // Contains transcript, duration, summary
//       case 'end-of-call-report':
//         await this.handleEndOfCallReport(message);
//         return {};

//       // Other types: status-update, transcript, etc
//       // We log them but don't process
//       default:
//         this.logger.log(`Vapi message: ${message?.type}`);
//         return {};
//     }
//   }

//   // ── Route function calls to the correct handler
//   // Vapi AI decides which function to call based on
//   // the conversation. We defined these functions when
//   // creating the assistant (next step).
//   private async handleToolCalls(message: any) {
//     const toolCalls = message.toolCallList || [];

//     const callId = message.call?.id;

//     // Process each tool call in the array
//     // (usually just 1, but Vapi allows batching)
//     const results = await Promise.all(
//       toolCalls.map(async (call: any) => {
//         const { id, function: fn } = call;
//         const { name, arguments: args } = fn;

//         this.logger.log(`Vapi tool: ${name}`);

//         // Route to handler — returns plain data (no { result: ... } wrapper)
//         let result: any;
//         try {
//           switch (name) {
//             case 'getServices':
//               result = await this.getServices(args);
//               break;
//             case 'getAvailableSlots':
//               result = await this.getAvailableSlots(args);
//               break;
//             case 'createBooking':
//               result = await this.createBooking(args, callId);
//               break;
//             case 'getStaff':
//               result = await this.getStaff(args);
//               break;
//             default:
//               this.logger.warn(`Unknown tool: ${name}`);
//               result = { error: 'Unknown tool' };
//           }
//         } catch (err) {
//           this.logger.error(`Tool ${name} failed: ${(err as Error).message}`);
//           result = { error: 'Internal error processing request' };
//         }

//         return {
//           toolCallId: id,
//           result: JSON.stringify(result), // Vapi expects string result
//         };
//       }),
//     );

//     return { results };
//   }

//   // ── Function 1: Get services for the org
//   // AI calls this when customer asks "what services do you have?"
//   // Returns a list of services the AI reads to the customer.
//   private async getServices(params: { slug: string }) {
//     const slug = params.slug?.trim();

//     if (!slug) {
//       return {
//         error: 'Missing slug parameter. Always pass slug in tool calls.',
//       };
//     }

//     const org = await this.prisma.db.organisation.findUnique({
//       where: { slug },
//       include: {
//         services: {
//           where: { isActive: true },
//           select: {
//             id: true,
//             name: true,
//             durationMins: true,
//             price: true,
//             description: true,
//           },
//         },
//       },
//     });

//     if (!org || org.isDeleted) {
//       return { error: 'Business not found' };
//     }

//     if (org.planTier === 'STARTER' || !org.voiceAiEnabled) {
//       return {
//         error:
//           'Voice booking is not available for this business. Please book manually instead.',
//       };
//     }

//     return {
//       services: org.services.map((s) => ({
//         id: s.id,
//         name: s.name,
//         duration: `${s.durationMins} minutes`,
//         price: s.price,
//         description: s.description || '',
//       })),
//     };
//   }

//   // ── Function 2: Get available time slots ────────────
//   // AI calls this when customer picks a service and date.
//   // Same slot calculation logic as public-booking service.
//   private async getAvailableSlots(params: {
//     slug: string;
//     serviceId: string;
//     date: string;
//     staffId?: string;
//   }) {
//     const slug = params.slug?.trim();
//     const date = params.date?.trim();
//     const serviceId = params.serviceId?.trim();
//     const staffId = params.staffId?.trim();

//     if (!slug) {
//       return {
//         error: 'Missing slug parameter. Always pass slug in tool calls.',
//       };
//     }
//     if (!date) {
//       return {
//         error: 'Missing date parameter. Ask the customer which day they want.',
//       };
//     }
//     if (!serviceId) {
//       return {
//         error:
//           'Service not found or not selected yet. Ask the customer which service they want to book BEFORE checking time slots.',
//       };
//     }

//     // Step 1: Get org and working hours
//     const org = await this.prisma.db.organisation.findUnique({
//       where: { slug },
//       include: { workingHours: true },
//     });

//     if (!org || org.isDeleted) {
//       return { error: 'Business not found' };
//     }

//     // Step 2: Get the service (need duration for slot size)
//     const service = await this.prisma.db.service.findUnique({
//       where: { id: serviceId },
//     });

//     if (!service || service.orgId !== org.id) {
//       return { error: 'Service not found' };
//     }

//     // Step 3: Which day of the week is this date?
//     const bookingDate = new Date(date);
//     const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
//     const dayOfWeek = dayNames[bookingDate.getDay()];

//     const hours = org.workingHours.find((h) => h.day === dayOfWeek);

//     if (!hours || !hours.isOpen) {
//       return {
//         slots: [],
//         message: 'Business is closed on this day',
//       };
//     }

//     // Step 4: Get existing bookings for that day
//     const dayStart = new Date(date);
//     dayStart.setHours(0, 0, 0, 0);
//     const dayEnd = new Date(date);
//     dayEnd.setHours(23, 59, 59, 999);

//     const bookingWhere: any = {
//       orgId: org.id,
//       status: { in: ['PENDING', 'CONFIRMED'] },
//       startAt: { gte: dayStart, lte: dayEnd },
//     };

//     if (staffId) {
//       bookingWhere.userId = staffId;
//     }

//     const existingBookings = await this.prisma.db.booking.findMany({
//       where: bookingWhere,
//     });

//     // Step 5: Generate all possible slots
//     const slotDuration = service.durationMins;
//     const buffer = service.buffer || org.bufferMins || 0;

//     const [openH, openM] = hours.openTime.split(':').map(Number);
//     const [closeH, closeM] = hours.closeTime.split(':').map(Number);
//     const openMins = openH * 60 + openM;
//     const closeMins = closeH * 60 + closeM;

//     const allSlots: string[] = [];
//     for (let mins = openMins; mins + slotDuration <= closeMins; mins += 30) {
//       const hour = Math.floor(mins / 60);
//       const minute = mins % 60;
//       allSlots.push(
//         `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
//       );
//     }

//     // Step 6: Remove slots that conflict with existing bookings
//     const availableSlots = allSlots.filter((slot) => {
//       const [slotH, slotM] = slot.split(':').map(Number);
//       const slotStart = slotH * 60 + slotM;
//       const slotEnd = slotStart + slotDuration + buffer;

//       const hasConflict = existingBookings.some((booking) => {
//         const bookingStart =
//           booking.startAt.getHours() * 60 + booking.startAt.getMinutes();
//         const bookingEnd =
//           booking.endAt.getHours() * 60 + booking.endAt.getMinutes() + buffer;
//         return slotStart < bookingEnd && slotEnd > bookingStart;
//       });

//       return !hasConflict;
//     });

//     // Step 7: Remove past slots if booking is for today
//     const now = new Date();
//     const today = now.toISOString().split('T')[0];
//     const requestDate = bookingDate.toISOString().split('T')[0];

//     let finalSlots = availableSlots;

//     if (requestDate === today) {
//       const currentMins = now.getHours() * 60 + now.getMinutes();
//       const leadTime = org.minLeadTimeMins || 0;
//       const minBookingTime = currentMins + leadTime;

//       finalSlots = availableSlots.filter((slot) => {
//         const [h, m] = slot.split(':').map(Number);
//         return h * 60 + m >= minBookingTime;
//       });
//     }

//     return {
//       slots: finalSlots,
//       message:
//         finalSlots.length > 0
//           ? `Available times: ${finalSlots.join(', ')}`
//           : 'No available slots for this date',
//     };
//   }

//   // ── Function 3: Create booking
//   // AI calls this after collecting all customer details.
//   // Creates customer (or finds existing) + creates booking.
//   private async createBooking(
//     params: {
//       slug: string;
//       serviceId: string;
//       date: string;
//       time: string;
//       customerName: string;
//       customerEmail: string;
//       customerPhone: string;
//       staffId?: string;
//       note?: string;
//     },
//     callId?: string,
//   ) {
//     const slug = params.slug?.trim();
//     const date = params.date?.trim();
//     const time = params.time?.trim();
//     const serviceId = params.serviceId?.trim();
//     const staffId = params.staffId?.trim();
//     const customerName = params.customerName?.trim();
//     const customerEmail = params.customerEmail?.trim();
//     const customerPhone = params.customerPhone?.trim();
//     const note = params.note?.trim();

//     // ── Defensive validation
//     if (!slug) {
//       return {
//         error: 'Missing slug parameter. Always pass slug in tool calls.',
//       };
//     }
//     if (!date) {
//       return {
//         error: 'Missing date parameter. Ask the customer which day they want.',
//       };
//     }
//     if (!time) {
//       return {
//         error: 'Missing time parameter. Ask the customer what time they want.',
//       };
//     }
//     if (!serviceId) {
//       return {
//         error:
//           'Service not found or not selected yet. Ask the customer which service they want to book first.',
//       };
//     }

//     // ── Validate required customer fields
//     if (!customerName) {
//       return {
//         error:
//           'Missing customer name. Please ask the customer for their name before booking.',
//       };
//     }
//     if (!customerEmail) {
//       return {
//         error:
//           'Missing customer email. Please ask the customer for their email before booking.',
//       };
//     }
//     if (!customerPhone) {
//       return {
//         error:
//           'Missing customer phone. Please ask the customer for their phone number before booking.',
//       };
//     }

//     // Basic email sanity check
//     if (!customerEmail.includes('@')) {
//       return {
//         error:
//           'Customer email looks invalid. Please confirm the email with the customer.',
//       };
//     }

//     const org = await this.prisma.db.organisation.findUnique({
//       where: { slug },
//     });

//     if (!org || org.isDeleted) {
//       return { error: 'Business not found' };
//     }

//     if (org.planTier === 'STARTER' || !org.voiceAiEnabled) {
//       return {
//         error:
//           'Voice booking is not available for this business. Please book manually instead.',
//       };
//     }

//     const cap = TIER_LIMITS[org.planTier].bookingsPerMonth;
//     if (cap !== UNLIMITED) {
//       const bookingsThisMonth = await this.prisma.db.booking.count({
//         where: {
//           orgId: org.id,
//           createdAt: { gte: startOfMonth(new Date()) },
//         },
//       });
//       if (bookingsThisMonth >= cap) {
//         return {
//           error:
//             'This business is not accepting online bookings at the moment. Please contact them directly to schedule.',
//         };
//       }
//     }

//     const service = await this.prisma.db.service.findUnique({
//       where: { id: serviceId },
//     });

//     if (!service || service.orgId !== org.id) {
//       return { error: 'Service not found' };
//     }

//     // Calculate start and end times from "10:00" + duration
//     const [hour, minute] = time.split(':').map(Number);
//     const startAt = new Date(date);
//     startAt.setHours(hour, minute, 0, 0);

//     const endAt = new Date(startAt);
//     endAt.setMinutes(endAt.getMinutes() + service.durationMins);

//     let booking: any;
//     try {
//       booking = await this.prisma.db.$transaction(async (tx) => {
//         const conflict = await tx.booking.findFirst({
//           where: {
//             orgId: org.id,
//             status: { in: ['PENDING', 'CONFIRMED'] },
//             startAt: { lt: endAt },
//             endAt: { gt: startAt },
//             ...(staffId ? { userId: staffId } : {}),
//           },
//         });
//         if (conflict) throw new Error('SLOT_TAKEN');

//         // Find or create customer
//         let customer = await tx.customer.findFirst({
//           where: { email: customerEmail, orgId: org.id },
//         });

//         if (customer) {
//           customer = await tx.customer.update({
//             where: { id: customer.id },
//             data: {
//               name: customerName,
//               phone: customerPhone,
//             },
//           });
//         } else {
//           customer = await tx.customer.create({
//             data: {
//               name: customerName,
//               email: customerEmail,
//               phone: customerPhone,
//               orgId: org.id,
//             },
//           });
//         }

//         // Create booking with VOICE_AI source
//         const newBooking = await tx.booking.create({
//           data: {
//             startAt,
//             endAt,
//             source: 'VOICE_AI',
//             status: 'PENDING',
//             note: note || null,
//             voiceCallId: callId || null,
//             customerId: customer.id,
//             serviceId,
//             userId: staffId || null,
//             orgId: org.id,
//           },
//           include: { user: true },
//         });

//         return newBooking;
//       });
//     } catch (err) {
//       if ((err as Error).message === 'SLOT_TAKEN') {
//         return {
//           error:
//             'This time slot is no longer available. Please select another time.',
//         };
//       }
//       throw err;
//     }

//     // Send confirmation email
//     await this.emailService.sendBookingConfirmationEmail(
//       customerEmail,
//       customerName,
//       org.name,
//       service.name,
//       booking.user
//         ? `${booking.user.firstName} ${booking.user.lastName}`
//         : null,
//       startAt.toLocaleDateString(),
//       startAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
//     );

//     await this.notificationService.notifyOrgAdmins(
//       org.id,
//       'New Voice Booking',
//       `${customerName} booked ${service.name} via AI`,
//       'BOOKING',
//       'BOOKING',
//       booking.id,
//     );

//     await this.auditService.log({
//       orgId: org.id,
//       actorName: customerName,
//       action: 'BOOKING_CREATED',
//       entityType: 'Booking',
//       entityId: booking.id,
//       metadata: { source: 'VOICE_AI', serviceName: service.name },
//     });

//     this.logger.log(`Voice AI booking created: ${booking.id}`);

//     return {
//       success: true,
//       bookingId: booking.id,
//       message: `Booking confirmed! ${customerName} is booked for ${service.name} on ${startAt.toLocaleDateString()} at ${startAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
//     };
//   }

//   // ── Function 4: Get staff available at a specific date+time
//   // AI calls this only when customer expresses staff preference
//   // or asks who's free — NOT for every booking
//   private async getStaff(params: {
//     slug: string;
//     date: string;
//     time: string;
//     serviceId: string;
//   }) {
//     // ── Defensive validation — Vapi LLM occasionally drops required params
//     const slug = params.slug?.trim();
//     const date = params.date?.trim();
//     const time = params.time?.trim();
//     const serviceId = params.serviceId?.trim();

//     if (!slug) {
//       return {
//         error: 'Missing slug parameter. Always pass slug in tool calls.',
//       };
//     }
//     if (!date) {
//       return {
//         error: 'Missing date parameter. Ask the customer which day they want.',
//       };
//     }
//     if (!time) {
//       return {
//         error: 'Missing time parameter. Ask the customer what time they want.',
//       };
//     }
//     if (!serviceId) {
//       return {
//         error:
//           'Cannot check staff without a confirmed service. Ask the customer which service first.',
//       };
//     }

//     // ── Get org + active staff
//     const org = await this.prisma.db.organisation.findUnique({
//       where: { slug },
//       include: {
//         users: {
//           where: { status: 'ACTIVE' },
//           select: { id: true, firstName: true, lastName: true },
//         },
//       },
//     });

//     if (!org || org.isDeleted) {
//       return { error: 'Business not found' };
//     }

//     if (org.planTier === 'STARTER' || !org.voiceAiEnabled) {
//       return { error: 'Voice booking is not available for this business.' };
//     }

//     // ── Get service to know booking duration
//     const service = await this.prisma.db.service.findUnique({
//       where: { id: serviceId },
//     });

//     if (!service || service.orgId !== org.id || service.isDeleted) {
//       return {
//         error:
//           'Cannot check staff without a confirmed service. Ask the customer which service first.',
//       };
//     }

//     // ── Calculate the booking window
//     const [hour, minute] = time.split(':').map(Number);
//     const startAt = new Date(date);
//     startAt.setHours(hour, minute, 0, 0);

//     const endAt = new Date(startAt);
//     endAt.setMinutes(endAt.getMinutes() + service.durationMins);

//     // ── Find staff with conflicting bookings at this window (with buffer)
//     const buffer = service.buffer || org.bufferMins || 0;
//     const bufferedStart = new Date(startAt.getTime() - buffer * 60000);
//     const bufferedEnd = new Date(endAt.getTime() + buffer * 60000);

//     const conflictingBookings = await this.prisma.db.booking.findMany({
//       where: {
//         orgId: org.id,
//         status: { in: ['PENDING', 'CONFIRMED'] },
//         userId: { not: null },
//         startAt: { lt: bufferedEnd },
//         endAt: { gt: bufferedStart },
//       },
//       select: { userId: true },
//     });

//     const busyStaffIds = new Set(
//       conflictingBookings.map((b) => b.userId).filter(Boolean),
//     );

//     // ── Filter roster to only free staff
//     const availableStaff = org.users
//       .filter((u) => !busyStaffIds.has(u.id))
//       .map((u) => ({
//         id: u.id,
//         name: `${u.firstName} ${u.lastName}`,
//       }));

//     return {
//       available: availableStaff,
//       busyCount: org.users.length - availableStaff.length,
//       message:
//         availableStaff.length > 0
//           ? `${availableStaff.length} staff available at this time`
//           : 'No staff available at this time',
//     };
//   }

//   // ── End of call report
//   // Vapi sends this AFTER the conversation ends.
//   // Contains the full transcript and call duration.
//   // We find the booking created during this call
//   // and save the transcript for reporting.
//   private async handleEndOfCallReport(message: any) {
//     const callId = message.call?.id;
//     const durationSeconds = message.durationSeconds ?? null;
//     const transcript = message.transcript;
//     const endedReason = message.endedReason;

//     const slug = message.call?.assistantOverrides?.variableValues?.slug;

//     this.logger.log(
//       `Call ${callId} ended. Duration: ${durationSeconds}s. Reason: ${endedReason}`,
//     );

//     if (!callId) {
//       this.logger.warn(
//         'end-of-call-report missing call.id — cannot track usage',
//       );
//       return;
//     }

//     if (!slug) {
//       this.logger.warn(`Call ${callId} missing slug — cannot attribute usage`);
//       return;
//     }

//     const org = await this.prisma.db.organisation.findUnique({
//       where: { slug },
//       select: { id: true },
//     });

//     if (!org) {
//       this.logger.warn(`Call ${callId} for unknown slug: ${slug}`);
//       return;
//     }

//     try {
//       await this.prisma.db.voiceUsage.create({
//         data: {
//           callId,
//           duration: durationSeconds ?? 0,
//           orgId: org.id,
//         },
//       });
//       this.logger.log(
//         `Voice usage tracked: org=${org.id} callId=${callId} duration=${durationSeconds}s`,
//       );
//     } catch (err) {
//       if ((err as any).code === 'P2002') {
//         this.logger.log(
//           `Duplicate webhook for callId ${callId} — already tracked`,
//         );
//       } else {
//         this.logger.error(
//           `Failed to track voice usage: ${(err as Error).message}`,
//         );
//       }
//     }

//     if (transcript) {
//       const booking = await this.prisma.db.booking.findFirst({
//         where: { voiceCallId: callId },
//       });

//       if (booking) {
//         await this.prisma.db.booking.update({
//           where: { id: booking.id },
//           data: {
//             voiceTranscript: transcript,
//             voiceDuration: durationSeconds || null,
//           },
//         });
//         this.logger.log(`Transcript saved for booking: ${booking.id}`);
//       } else {
//         this.logger.log(
//           `No booking for call ${callId} — minutes tracked, no transcript link`,
//         );
//       }
//     }
//   }
// }

import { Injectable, Logger } from '@nestjs/common';
import { startOfMonth } from 'date-fns';
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
    const activeStaffCount = activeStaffIds.length;

    const service = await this.prisma.db.service.findUnique({
      where: { id: serviceId },
    });
    if (!service || service.orgId !== org.id)
      return { error: 'Service not found' };

    const bookingDate = new Date(date);
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayOfWeek = dayNames[bookingDate.getDay()];
    const hours = org.workingHours.find((h) => h.day === dayOfWeek);
    if (!hours || !hours.isOpen) {
      return {
        slots: [],
        reason: 'CLOSED',
        message: `The business is closed on ${dayOfWeek}s. Offer the customer a different day.`,
      };
    }

    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const bookingWhere: any = {
      orgId: org.id,
      status: { in: ['PENDING', 'CONFIRMED'] },
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
        const bookingStart =
          booking.startAt.getHours() * 60 + booking.startAt.getMinutes();
        const bookingEnd =
          booking.endAt.getHours() * 60 + booking.endAt.getMinutes() + buffer;
        return slotStart < bookingEnd && slotEnd > bookingStart;
      });

      // Case 1: Specific staff requested → check only that staff's overlap
      if (staffId) {
        return overlappingBookings.length === 0;
      }

      // Case 2: No specific staff → check overall capacity
      if (activeStaffCount === 0) return false;

      // Count distinct busy active staff + unassigned bookings (they also consume capacity)
      const busyStaffIds = new Set<string>();
      let unassignedOverlapCount = 0;
      for (const booking of overlappingBookings) {
        if (booking.userId && activeStaffIds.includes(booking.userId)) {
          busyStaffIds.add(booking.userId);
        } else if (!booking.userId) {
          unassignedOverlapCount += 1;
        }
      }
      const capacityUsed = busyStaffIds.size + unassignedOverlapCount;
      return capacityUsed < activeStaffCount;
    });

    // Remove past slots if booking is for today
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

    if (finalSlots.length === 0) {
      return {
        slots: [],
        reason: 'FULLY_BOOKED',
        message:
          'The business is open this day but all slots are taken. Offer the customer a different day.',
      };
    }

    return {
      slots: finalSlots,
      reason: 'AVAILABLE',
      message: `Available times: ${finalSlots.join(', ')}`,
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
      include: {
        users: { where: { status: 'ACTIVE' }, select: { id: true } },
        workingHours: { where: { userId: null } },
      },
    });
    if (!org || org.isDeleted) return { error: 'Business not found' };
    if (org.planTier === 'STARTER' || !org.voiceAiEnabled) {
      return {
        error:
          'Voice booking is not available for this business. Please book manually instead.',
      };
    }

    const activeStaffIds = org.users.map((u) => u.id);
    const activeStaffCount = activeStaffIds.length;

    if (activeStaffCount === 0) {
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

    const service = await this.prisma.db.service.findUnique({
      where: { id: serviceId },
    });
    if (!service || service.orgId !== org.id)
      return { error: 'Service not found' };

    const [hour, minute] = time.split(':').map(Number);
    const startAt = new Date(date);
    startAt.setHours(hour, minute, 0, 0);
    const endAt = new Date(startAt);
    endAt.setMinutes(endAt.getMinutes() + service.durationMins);

    // ── Validate booking falls within business working hours
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayOfWeek = dayNames[startAt.getDay()];
    const dayHours = org.workingHours.find((h) => h.day === dayOfWeek);

    if (!dayHours || !dayHours.isOpen) {
      return {
        error: `The business is closed on ${dayOfWeek}s. Please offer the customer another day.`,
      };
    }

    const [openH, openM] = dayHours.openTime.split(':').map(Number);
    const [closeH, closeM] = dayHours.closeTime.split(':').map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;
    const bookingStartMinutes = startAt.getHours() * 60 + startAt.getMinutes();
    const bookingEndMinutes = endAt.getHours() * 60 + endAt.getMinutes();

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
        const overlappingBookings = await tx.booking.findMany({
          where: {
            orgId: org.id,
            status: { in: ['PENDING', 'CONFIRMED'] },
            startAt: { lt: bufferedEnd },
            endAt: { gt: bufferedStart },
          },
          select: { userId: true },
        });

        let finalStaffId: string | null = null;

        if (requestedStaffId) {
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
            if (b.userId && activeStaffIds.includes(b.userId)) {
              busyStaffIds.add(b.userId);
            } else if (!b.userId) {
              unassignedOverlapCount += 1;
            }
          }
          const capacityUsed = busyStaffIds.size + unassignedOverlapCount;
          if (capacityUsed >= activeStaffCount) throw new Error('SLOT_TAKEN');

          // Single-staff org → auto-assign. Multi-staff → leave null for admin.
          finalStaffId = activeStaffCount === 1 ? activeStaffIds[0] : null;
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
            serviceId,
            userId: finalStaffId,
            orgId: org.id,
          },
          include: { user: true },
        });

        return newBooking;
      });
    } catch (err) {
      const msg = (err as Error).message;
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
      startAt.toLocaleDateString(),
      startAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
      message: `Booking confirmed! ${customerName} is booked for ${service.name} on ${startAt.toLocaleDateString()} at ${startAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
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

    const service = await this.prisma.db.service.findUnique({
      where: { id: serviceId },
    });
    if (!service || service.orgId !== org.id || service.isDeleted) {
      return {
        error:
          'Cannot check staff without a confirmed service. Ask the customer which service first.',
      };
    }

    const [hour, minute] = time.split(':').map(Number);
    const startAt = new Date(date);
    startAt.setHours(hour, minute, 0, 0);
    const endAt = new Date(startAt);
    endAt.setMinutes(endAt.getMinutes() + service.durationMins);

    const buffer = service.buffer || org.bufferMins || 0;
    const bufferedStart = new Date(startAt.getTime() - buffer * 60000);
    const bufferedEnd = new Date(endAt.getTime() + buffer * 60000);

    const conflictingBookings = await this.prisma.db.booking.findMany({
      where: {
        orgId: org.id,
        status: { in: ['PENDING', 'CONFIRMED'] },
        userId: { not: null },
        startAt: { lt: bufferedEnd },
        endAt: { gt: bufferedStart },
      },
      select: { userId: true },
    });

    const busyStaffIds = new Set(
      conflictingBookings.map((b) => b.userId).filter(Boolean),
    );

    const availableStaff = org.users
      .filter((u) => !busyStaffIds.has(u.id))
      .map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` }));

    return {
      available: availableStaff,
      activeStaffCount: org.users.length,
      busyCount: org.users.length - availableStaff.length,
      message:
        availableStaff.length > 0
          ? `${availableStaff.length} of ${org.users.length} staff free at this time`
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
