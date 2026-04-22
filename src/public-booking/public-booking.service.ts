import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EmailService } from '../email/email.service.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PublicBoookingService {
  private readonly logger = new Logger(PublicBoookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
  ) {}

  //GET  /api/public/:slug
  async getOrgBySlug(slug: string) {
    const org = await this.prisma.db.organisation.findUnique({
      where: { slug },
      include: {
        services: {
          where: { isActive: true },
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
      success: true,
      data: {
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        description: org.description,
        phone: org.phone,
        address: org.address,
        services: org.services,
        staff: org.users,
        workingHours: org.workingHours,
      },
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
      include: { workingHours: true },
    });

    if (!org || org.isDeleted) {
      throw new NotFoundException('Business not found');
    }

    // ── Step 2: Get the service (need duration)
    const service = await this.prisma.db.service.findUnique({
      where: { id: serviceId },
    });

    if (!service || service.orgId !== org.id) {
      throw new NotFoundException('Service not found');
    }

    // ── Step 3: Find which day of the week
    const bookingDate = new Date(date);
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayOfWeek = dayNames[bookingDate.getDay()];

    // Find working hours for this day
    const hours = org.workingHours.find((h) => h.day === dayOfWeek);

    // If closed or no hours defined → no slots
    if (!hours || !hours.isOpen) {
      return { success: true, data: [] };
    }

    // ── Step 4: Get existing bookings for that day
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const bookingWhere: any = {
      orgId: org.id,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startAt: { gte: dayStart, lte: dayEnd },
    };

    // If specific staff selected → only their bookings
    // If no preference → get ALL staff bookings
    if (staffId) {
      bookingWhere.userId = staffId;
    }

    const existingBookings = await this.prisma.db.booking.findMany({
      where: bookingWhere,
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

      // Check if this slot conflicts with any existing booking
      const hasConflict = existingBookings.some((booking) => {
        const bookingStart =
          booking.startAt.getHours() * 60 + booking.startAt.getMinutes();
        const bookingEnd =
          booking.endAt.getHours() * 60 + booking.endAt.getMinutes() + buffer;

        // Overlap check: two ranges overlap if one starts before the other ends
        return slotStart < bookingEnd && slotEnd > bookingStart;
      });

      return !hasConflict;
    });

    // ── Step 7: Remove past slots if booking is today ───
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

    return { success: true, data: finalSlots };
  }

  //POST /api/public/bookings
  async createPublicBooking(data: any) {
    // Find the org by slug
    const org = await this.prisma.db.organisation.findUnique({
      where: { slug: data.slug },
    });

    if (!org || org.isDeleted) {
      throw new NotFoundException('Business not found');
    }

    // Verify service belongs to this org
    const service = await this.prisma.db.service.findUnique({
      where: { id: data.serviceId },
    });

    if (!service || service.orgId !== org.id) {
      throw new NotFoundException('Service not found');
    }

    const booking = await this.prisma.db.$transaction(async (tx) => {
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
          startAt: data.startAt,
          endAt: data.endAt,
          source: 'MANUAL_CUSTOMER',
          status: 'PENDING',
          note: data.note || null,
          customerId: customer.id,
          serviceId: data.serviceId,
          userId: data.staffId || null,
          orgId: org.id,
        },
        include: {
          user: true,
        },
      });

      return newBooking;
    });

    await this.emailService.sendBookingConfirmationEmail(
      data.customer.email,
      data.customer.name,
      org.name,
      service.name,
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
      org.id,
      'New Booking',
      `${data.customer.name} booked ${service.name}`,
      'BOOKING',
      'BOOKING',
      booking.id,
    );

    this.logger.log(`Public booking created: ${booking.id}`);

    return { success: true, data: booking };
  }
}
