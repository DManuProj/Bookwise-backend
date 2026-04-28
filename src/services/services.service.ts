import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../common/types/index.js';
import { CreateServiceDto, UpdateServiceDto } from './services.dto.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  // GET — fetch the organisation's services
  async getAllServices(user: AuthenticatedUser) {
    const services = await this.prisma.db.service.findMany({
      where: { orgId: user.orgId! },
    });

    this.logger.log(`get all serviece for ${user.org?.name} `);

    return { services };
  }

  // POST — create organisation's services
  async createService(user: AuthenticatedUser, data: CreateServiceDto) {
    const service = await this.prisma.db.service.create({
      data: {
        ...data,
        orgId: user.orgId!,
      },
    });

    await this.notificationService.notifyByRoles(
      user.orgId!,
      ['OWNER', 'ADMIN', 'MEMBER'],
      `Service Added`,
      ` New service has been added to your organisation`,
      'STAFF',
    );

    this.logger.log(`Service created: ${service.name}`);
    return { service };
  }

  // PUT — update organisation's services
  async updateService(
    user: AuthenticatedUser,
    id: string,
    data: UpdateServiceDto,
  ) {
    // Check service exists AND belongs to this org
    const existing = await this.prisma.db.service.findUnique({
      where: { id },
    });

    if (!existing) throw new NotFoundException('Service not found');

    if (existing.orgId !== user.orgId)
      throw new ForbiddenException('Not your service');

    const updated = await this.prisma.db.service.update({
      where: { id },
      data,
    });

    await this.notificationService.notifyByRoles(
      user.orgId!,
      ['OWNER', 'ADMIN', 'MEMBER'],
      'Service Updated',
      `${updated.name} has been updated`,
      'SERVICE',
    );

    this.logger.log(`Service updated: ${updated.name}`);

    return { updated };
  }

  // DELETE — delete organisation's services
  async deleteService(user: AuthenticatedUser, id: string) {
    const existing = await this.prisma.db.service.findUnique({
      where: { id },
    });

    if (!existing) throw new NotFoundException('Service not found');

    if (existing.orgId !== user.orgId)
      throw new ForbiddenException('Not your service');

    await this.prisma.db.service.delete({
      where: { id },
    });

    await this.notificationService.notifyByRoles(
      user.orgId!,
      ['OWNER', 'ADMIN', 'MEMBER'],
      `Service removed`,
      `${existing.name}has been deleted from your organisation`,
      'SERVICE',
    );

    this.logger.log(`Service deleted: ${existing.name}`);

    return { message: 'Service deleted' };
  }
}
