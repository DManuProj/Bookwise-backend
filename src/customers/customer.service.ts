import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../common/types/index.js';
import { UpdateCustomerNotesDto } from './customer.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // GET — all customers with optional search
  async getAllCustomers(
    user: AuthenticatedUser,
    name?: string,
    email?: string,
  ) {
    const where: any = {
      orgId: user.orgId,
    };

    // Partial match on name (case insensitive)
    if (name) {
      where.name = { contains: name, mode: 'insensitive' };
    }

    // Partial match on email
    if (email) {
      where.email = { contains: email, mode: 'insensitive' };
    }

    const customers = await this.prisma.db.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    this.logger.log(` fetching custoemrs for ${user.email}`);

    return customers;
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

    return customer;
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
