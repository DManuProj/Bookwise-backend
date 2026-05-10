import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../common/types/index.js';
import {
  GetCustomersQueryDto,
  UpdateCustomerNotesDto,
} from './customer.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // GET — all customers with optional search
  async getAllCustomers(user: AuthenticatedUser, query: GetCustomersQueryDto) {
    const { search, page = 1, limit = 10 } = query;

    // Filter: applies to list, count, and stats
    const baseWhere: any = { orgId: user.orgId! };

    if (search) {
      baseWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Pagination math
    const skip = (page - 1) * limit;

    // First day of current month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [customers, total, newThisMonth, returningCount] = await Promise.all([
      // List with per-row aggregations
      this.prisma.db.customer.findMany({
        where: baseWhere,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: {
            select: { bookings: true },
          },
          bookings: {
            where: { startAt: { lt: new Date() } }, // only past
            orderBy: { startAt: 'desc' },
            take: 1,
            select: { startAt: true },
          },
        },
      }),

      // Total count for pagination
      this.prisma.db.customer.count({ where: baseWhere }),

      // New this month
      this.prisma.db.customer.count({
        where: { ...baseWhere, createdAt: { gte: monthStart } },
      }),

      // Returning customers (have at least one booking)
      this.prisma.db.customer.count({
        where: {
          ...baseWhere,
          bookings: { some: {} },
        },
      }),
    ]);

    // Reshape rows: flatten _count and lastVisit into top-level fields
    const data = customers.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      notes: c.notes,
      createdAt: c.createdAt,
      totalBookings: c._count.bookings,
      lastVisit: c.bookings[0]?.startAt ?? null,
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      stats: {
        total,
        newThisMonth,
        returning: returningCount,
      },
    };
  }

  // GET — single customer with booking history
  async getCustomer(user: AuthenticatedUser, id: string) {
    const customer = await this.prisma.db.customer.findUnique({
      where: { id },
      include: {
        bookings: {
          include: {
            service: true,
            user: true,
          },
          orderBy: { startAt: 'desc' },
        },
      },
    });

    if (!customer || customer.orgId !== user.orgId) {
      throw new NotFoundException('Customer not found');
    }

    const now = new Date();

    // Past bookings, regardless of status
    const pastBookings = customer.bookings.filter(
      (b) => new Date(b.startAt) < now,
    );

    // Most recent past booking (bookings are already ordered desc)
    const lastVisit = pastBookings[0]?.startAt ?? null;
    const totalBookings = customer.bookings.length;
    const firstSeen = pastBookings.at(-1)?.startAt ?? customer.createdAt;

    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      notes: customer.notes,
      createdAt: customer.createdAt,
      totalBookings,
      lastVisit,
      firstSeen,
      bookings: customer.bookings,
    };
  }

  // PUT — update customer notes
  async updateCustomerNotes(
    user: AuthenticatedUser,
    id: string,
    data: UpdateCustomerNotesDto,
  ) {
    const customer = await this.prisma.db.customer.findUnique({
      where: { id },
    });

    if (!customer || customer.orgId !== user.orgId) {
      throw new NotFoundException('Customer not found');
    }

    const updated = await this.prisma.db.customer.update({
      where: { id },
      data: { notes: data.notes },
    });

    this.logger.log(`Customer notes updated: ${updated.email}`);

    return updated;
  }
}
