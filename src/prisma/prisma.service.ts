import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from './client.js';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly db: PrismaClient;

  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    this.db = new PrismaClient({ adapter });
  }

  async onModuleInit() {
    try {
      await this.db.$connect();
      this.logger.log('Database connected successfully');
    } catch (error) {
      this.logger.error('Database connection failed', error);
      process.exit(1);
    }
  }

  async onModuleDestroy() {
    await this.db.$disconnect();
    this.logger.log('Database disconnected');
  }
}
