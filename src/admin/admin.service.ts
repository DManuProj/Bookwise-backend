import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StaffService } from '../staff/staff.service.js';
import {
  PlanTier,
  BookingStatus,
  SuspendReason,
} from '../generated/prisma/enums.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffService: StaffService,
  ) {}

  async getStats() {
    const [
      organisations,
      users,
      bookings,
      services,
      planTierGroups,
      voiceAiEnabledOrgs,
    ] = await Promise.all([
      this.prisma.db.organisation.count({ where: { isDeleted: false } }),
      this.prisma.db.user.count(),
      this.prisma.db.booking.count(),
      this.prisma.db.service.count({ where: { isDeleted: false } }),
      this.prisma.db.organisation.groupBy({
        by: ['planTier'],
        where: { isDeleted: false },
        _count: true,
      }),
      this.prisma.db.organisation.count({
        where: { voiceAiEnabled: true, isDeleted: false },
      }),
    ]);

    const tierMap = new Map<PlanTier, number>();
    for (const row of planTierGroups) {
      tierMap.set(row.planTier, row._count);
    }

    return {
      totals: { organisations, users, bookings, services },
      subscriptions: {
        starter: tierMap.get(PlanTier.STARTER) ?? 0,
        pro: tierMap.get(PlanTier.PRO) ?? 0,
        business: tierMap.get(PlanTier.BUSINESS) ?? 0,
      },
      voiceAiEnabledOrgs,
    };
  }

  async getOrganisations(page: number, limit: number, search?: string) {
    const where = {
      isDeleted: false,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { slug: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [orgs, total] = await Promise.all([
      this.prisma.db.organisation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          slug: true,
          planTier: true,
          voiceAiEnabled: true,
          businessType: true,
          createdAt: true,
          _count: { select: { users: true, bookings: true } },
        },
      }),
      this.prisma.db.organisation.count({ where }),
    ]);

    const data = orgs.map(({ _count, ...org }) => ({
      ...org,
      userCount: _count.users,
      bookingCount: _count.bookings,
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getOrgDetail(id: string) {
    const [org, recentBookings, counts] = await Promise.all([
      this.prisma.db.organisation.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          slug: true,
          logo: true,
          description: true,
          address: true,
          businessType: true,
          timezone: true,
          phone: true,
          planTier: true,
          voiceAiEnabled: true,
          isDeleted: true,
          isSuspended: true,
          suspendedAt: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          createdAt: true,
          users: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
              status: true,
              photoUrl: true,
              createdAt: true,
            },
          },
          services: {
            select: {
              id: true,
              name: true,
              price: true,
              durationMins: true,
              isActive: true,
              isDeleted: true,
            },
          },
          workingHours: {
            where: { userId: null },
            select: {
              day: true,
              isOpen: true,
              openTime: true,
              closeTime: true,
            },
          },
        },
      }),
      this.prisma.db.booking.findMany({
        where: { orgId: id },
        orderBy: { startAt: 'desc' },
        take: 10,
        select: {
          id: true,
          startAt: true,
          endAt: true,
          status: true,
          source: true,
          createdAt: true,
          customer: { select: { name: true } },
          service: { select: { name: true } },
        },
      }),
      this.prisma.db.organisation.findUnique({
        where: { id },
        select: {
          _count: {
            select: {
              users: true,
              bookings: true,
              customers: true,
            },
          },
          services: {
            where: { isDeleted: false },
            select: { id: true },
          },
        },
      }),
    ]);

    if (!org) throw new NotFoundException(`Organisation ${id} not found`);

    const { users, services, workingHours, ...organisation } = org;

    return {
      organisation,
      staff: users,
      services,
      workingHours,
      recentBookings: recentBookings.map(({ customer, service, ...b }) => ({
        ...b,
        customerName: customer.name,
        serviceName: service.name,
      })),
      counts: {
        staff: counts!._count.users,
        services: counts!.services.length,
        bookings: counts!._count.bookings,
        customers: counts!._count.customers,
      },
    };
  }

  async getOrgBookings(
    id: string,
    page: number,
    limit: number,
    from?: string,
    to?: string,
  ) {
    const where = {
      orgId: id,
      ...(from || to
        ? {
            startAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    };

    const [bookings, total, statusGroups] = await Promise.all([
      this.prisma.db.booking.findMany({
        where,
        orderBy: { startAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          orgId: true,
          customerId: true,
          serviceId: true,
          userId: true,
          startAt: true,
          endAt: true,
          status: true,
          source: true,
          note: true,
          createdAt: true,
          customer: { select: { name: true, phone: true } },
          service: { select: { name: true, durationMins: true } },
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.db.booking.count({ where }),
      this.prisma.db.booking.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
    ]);

    const statusMap = new Map<BookingStatus, number>();
    for (const row of statusGroups) {
      statusMap.set(row.status, row._count);
    }

    const pending = statusMap.get(BookingStatus.PENDING) ?? 0;
    const confirmed = statusMap.get(BookingStatus.CONFIRMED) ?? 0;
    const completed = statusMap.get(BookingStatus.COMPLETED) ?? 0;
    const cancelled = statusMap.get(BookingStatus.CANCELLED) ?? 0;
    const noShow = statusMap.get(BookingStatus.NO_SHOW) ?? 0;

    const data = bookings.map(({ customer, service, user, ...booking }) => ({
      ...booking,
      customer: customer ?? null,
      service: service ?? null,
      user: user ?? null,
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      stats: {
        total: pending + confirmed + completed + cancelled + noShow,
        pending,
        confirmed,
        completed,
        cancelled,
        noShow,
      },
    };
  }

  async getOrgAuditLogs(id: string, page: number, limit: number) {
    const where = { orgId: id };

    const [logs, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.db.auditLog.count({ where }),
    ]);

    const data = logs.map(({ user, actorName, ...log }) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      actorName: user ? `${user.firstName} ${user.lastName}` : actorName,
      metadata: log.metadata,
      createdAt: log.createdAt,
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getUsers(page: number, limit: number, search?: string) {
    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          clerkId: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          photoUrl: true,
          createdAt: true,
          org: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.db.user.count({ where }),
    ]);

    return { data: users, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async setVoiceAi(orgId: string, enabled: boolean, actorClerkId: string) {
    const org = await this.prisma.db.organisation.findUnique({
      where: { id: orgId },
      select: { id: true, planTier: true, voiceAiEnabled: true },
    });
    if (!org) throw new NotFoundException(`Organisation ${orgId} not found`);

    if (enabled === true && org.planTier === PlanTier.STARTER) {
      throw new BadRequestException('Voice AI requires a PRO or BUSINESS plan');
    }

    const updated = await this.prisma.db.organisation.update({
      where: { id: orgId },
      data: { voiceAiEnabled: enabled },
      select: { id: true, name: true, slug: true, voiceAiEnabled: true },
    });

    await this.logPlatformAction({
      actorClerkId,
      action: 'TOGGLE_VOICE_AI',
      targetOrgId: orgId,
      before: { voiceAiEnabled: org.voiceAiEnabled },
      after: { voiceAiEnabled: updated.voiceAiEnabled },
    });

    return updated;
  }

  async setPlanTier(orgId: string, planTier: PlanTier, actorClerkId: string) {
    const org = await this.prisma.db.organisation.findUnique({
      where: { id: orgId },
      select: { id: true, planTier: true, voiceAiEnabled: true },
    });
    if (!org) throw new NotFoundException(`Organisation ${orgId} not found`);

    const data: { planTier: PlanTier; voiceAiEnabled?: boolean } = { planTier };
    if (planTier === PlanTier.STARTER) data.voiceAiEnabled = false;

    const updated = await this.prisma.db.organisation.update({
      where: { id: orgId },
      data,
      select: {
        id: true,
        name: true,
        slug: true,
        planTier: true,
        voiceAiEnabled: true,
      },
    });

    await this.logPlatformAction({
      actorClerkId,
      action: 'CHANGE_PLAN_TIER',
      targetOrgId: orgId,
      before: { planTier: org.planTier, voiceAiEnabled: org.voiceAiEnabled },
      after: {
        planTier: updated.planTier,
        voiceAiEnabled: updated.voiceAiEnabled,
      },
    });

    // Downgrades may leave more active staff than the new tier allows
    await this.staffService.autoFreezeToStaffCap(orgId);

    return updated;
  }

  async setSuspended(orgId: string, suspended: boolean, actorClerkId: string) {
    const org = await this.prisma.db.organisation.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        isSuspended: true,
        suspendedAt: true,
        suspendedReason: true,
      },
    });
    if (!org) throw new NotFoundException(`Organisation ${orgId} not found`);

    const updated = await this.prisma.db.organisation.update({
      where: { id: orgId },
      data: {
        isSuspended: suspended,
        suspendedAt: suspended ? new Date() : null,
        suspendedReason: suspended ? SuspendReason.ADMIN : null,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        isSuspended: true,
        suspendedAt: true,
        suspendedReason: true,
      },
    });

    await this.logPlatformAction({
      actorClerkId,
      action: suspended ? 'SUSPEND_ORG' : 'REACTIVATE_ORG',
      targetOrgId: orgId,
      before: {
        isSuspended: org.isSuspended,
        suspendedAt: org.suspendedAt,
        suspendedReason: org.suspendedReason,
      },
      after: {
        isSuspended: updated.isSuspended,
        suspendedAt: updated.suspendedAt,
        suspendedReason: updated.suspendedReason,
      },
    });

    return updated;
  }

  private async logPlatformAction(params: {
    actorClerkId: string;
    action: string;
    targetOrgId?: string | null;
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    try {
      await this.prisma.db.platformAuditLog.create({
        data: {
          actorClerkId: params.actorClerkId,
          action: params.action,
          targetOrgId: params.targetOrgId ?? null,
          before: params.before === undefined ? undefined : (params.before as any),
          after: params.after === undefined ? undefined : (params.after as any),
        },
      });
    } catch (err) {
      console.error('[PlatformAuditLog] failed to write log row', err);
    }
  }
}
