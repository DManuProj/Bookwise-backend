import { Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    orgId: string;
    userId?: string;
    actorName?: string;
    action: AuditAction;
    entityType: string;
    entityId: string;
    metadata?: object;
  }) {
    try {
      await this.prisma.db.auditLog.create({ data: params });
    } catch (err) {
      this.logger.error('AuditLog write failed', err);
    }
  }
}
