import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedUser } from '../common/types/index.js';

@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  //GET DASHBOARD OVERVIEW
  async getDashboardOverview(user: AuthenticatedUser) {
    const orgId = user.orgId!;
    const now = new Date(); // current date and time

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0); // set to midnight (start of today)

    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999); // set to 23:59:59.999 (end of today)

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1); // first day of the current month at midnight

    const [
      todayBookings,
      monthBookingsCount,
      serviceGroups,
      staffCount,
      pendingInvitesCount,
      pendingBookingsCount,
      statusGroupsMonth,
      topServices,
      recentActivity,
    ] = await Promise.all([
      //  Today's bookings (full data) — feeds 3 UI elements:
      //      stats.todayBookings.total, stats.todayBookings.pending, upcomingToday list
      this.prisma.db.booking.findMany({
        where: {
          orgId,
          startAt: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
        include: { service: true, customer: true, user: true },
        orderBy: { startAt: 'asc' },
      }),

      // This month total bookings count — feeds stats.monthBookings.total
      this.prisma.db.booking.count({
        where: {
          orgId,
          startAt: { gte: monthStart },
        },
      }),

      // Services grouped by isActive — feeds stats.services { active, inactive }
      this.prisma.db.service.groupBy({
        by: ['isActive'],
        where: { orgId, isDeleted: false },
        _count: { _all: true },
      }),

      // Active staff count — feeds stats.staff.total
      this.prisma.db.user.count({
        where: {
          orgId,
          status: 'ACTIVE',
        },
      }),

      // Pending invitations count — feeds stats.staff.pendingInvitations
      this.prisma.db.staffInvitation.count({
        where: {
          orgId,
          status: 'PENDING',
        },
      }),

      // All pending bookings count (any time) — feeds the alert banner
      this.prisma.db.booking.count({
        where: {
          orgId,
          status: 'PENDING',
        },
      }),

      // Bookings grouped by status (this month) — feeds the donut chart
      this.prisma.db.booking.groupBy({
        by: ['status'],
        where: {
          orgId,
          startAt: { gte: monthStart },
        },
        _count: { _all: true },
      }),

      // Top 5 services by booking count (all-time) — feeds the bar chart
      this.prisma.db.service.findMany({
        where: { orgId, isDeleted: false },
        select: {
          id: true,
          name: true,
          _count: {
            select: {
              bookings: true,
            },
          },
        },
        orderBy: { bookings: { _count: 'desc' } },
        take: 5,
      }),

      // Recent activity feed — last 8 audit log entries, newest first
      this.prisma.db.auditLog.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    //reshape

    //services
    const services = { active: 0, inactive: 0 };

    for (const group of serviceGroups) {
      if (group.isActive) {
        services.active = group._count._all;
      } else services.inactive = group._count._all;
    }

    //reshapes statusGroupsMonth
    const bookingsByStatus = {
      pending: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
    };

    for (const group of statusGroupsMonth) {
      switch (group.status) {
        case 'PENDING':
          bookingsByStatus.pending = group._count._all;
          break;
        case 'CONFIRMED':
          bookingsByStatus.confirmed = group._count._all;
          break;
        case 'COMPLETED':
          bookingsByStatus.completed = group._count._all;
          break;
        case 'CANCELLED':
          bookingsByStatus.cancelled = group._count._all;
          break;
        case 'NO_SHOW':
          bookingsByStatus.noShow = group._count._all;
          break;
      }
    }

    //reshape topservices
    const topServicesShaped = topServices.map((s) => ({
      id: s.id,
      name: s.name,
      bookingCount: s._count.bookings,
    }));

    ///upcommming bookings
    const upcomingToday = todayBookings.map((b) => ({
      id: b.id,
      startAt: b.startAt,
      status: b.status,
      customer: { id: b.customer.id, name: b.customer.name },
      service: { id: b.service.id, name: b.service.name },
      user: b.user
        ? {
            id: b.user.id,
            firstName: b.user.firstName,
            lastName: b.user.lastName,
          }
        : null,
    }));

    return {
      stats: {
        todayBookings: {
          total: todayBookings.length,
          pending: todayBookings.filter((b) => b.status === 'PENDING').length,
        },
        monthBookings: { total: monthBookingsCount },
        services, // from reshape 2
        staff: { total: staffCount, pendingInvitations: pendingInvitesCount },
      },
      pendingBookingsCount,
      bookingsByStatus, // from reshape 3
      topServices: topServicesShaped, // from reshape 4
      upcomingToday, // from reshape 5
      recentActivity, // raw audit log array — no reshape needed
    };
  }
}
