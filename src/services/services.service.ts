import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../generated/prisma/prisma.service.js';
import { AuthenticatedUser } from '../common/types/index.js';
import { CreateServiceDto, UpdateServiceDto } from './services.dto.js';

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // GET — fetch the organisation's services
  async getAllServices(user: AuthenticatedUser) {
    const services = await this.prisma.db.service.findMany({
      where: { orgId: user.orgId! },
    });

    this.logger.log(`get all serviece for ${user.org?.name} `);

    return { success: true, data: services };
  }

  // POST — create organisation's services
  async createService(user: AuthenticatedUser, data: CreateServiceDto) {
    const service = await this.prisma.db.service.create({
      data: {
        ...data,
        orgId: user.orgId!,
      },
    });

    this.logger.log(`Service created: ${service.name}`);
    return { success: true, data: service };
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

    this.logger.log(`Service updated: ${updated.name}`);

    return { success: true, data: updated };
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

    this.logger.log(`Service deleted: ${existing.name}`);

    return { success: true, message: 'Service deleted' };
  }
}
