import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../common/types/index.js';
import { BookingSource, BookingStatus } from '../generated/prisma/enums.js';
import { CreateBookingDto, UpdateBookingDto } from './booking.dto.js';
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
  async getAllBookings(
    user: AuthenticatedUser,
    status: string,
    date: Date,
    staffId?: string,
  ) {
    // Build where clause dynamically
    const where: any = {
      orgId: user.orgId!,
    };

    // Filter by status if provided
    if (status) {
      where.status = status;
    }

    // Filter by date if provided (full day range)
    if (date) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      where.startAt = {
        gte: dayStart,
        lte: dayEnd,
      };
    }

    // Filter by staff member if provided
    if (staffId) {
      where.userId = staffId;
    }

    const bookings = await this.prisma.db.booking.findMany({
      where,
      include: {
        service: true, // include service name, duration, price
        customer: true, // include customer name, email, phone
        user: true, // include staff name
      },
      orderBy: { startAt: 'asc' },
    });

    return bookings;
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
          endAt: data.endAt,
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

  //DELETE - booking
  async cancelBooking(user: AuthenticatedUser, id: string) {
    const booking = await this.prisma.db.booking.findUnique({
      where: { id },
      include: { customer: true, service: true },
    });

    if (!booking || booking.orgId !== user.orgId) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.status === 'CANCELLED') {
      throw new BadRequestException('Booking is already cancelled');
    }

    if (booking.status === 'COMPLETED') {
      throw new BadRequestException('Cannot cancel a completed booking');
    }

    const cancelled = await this.prisma.db.booking.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    //create an email
    await this.emailService.sendBookingStatusEmail(
      booking!.customer.email,
      booking!.customer.name,
      user.org?.name || '',
      booking!.service.name,
      'CANCELLED',
      booking!.startAt.toLocaleDateString(),
      booking!.startAt.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    );

    //send a notification
    await this.notificationService.notifyOrgAdmins(
      user.orgId!,
      'Booking Cancelled',
      `Booking for ${booking.customer.name} was cancelled`,
      'BOOKING',
      'BOOKING',
      booking.id,
    );

    this.logger.log(`Booking cancelled: ${cancelled.id}`);

    return { message: 'Booking cancelled' };
  }
}
