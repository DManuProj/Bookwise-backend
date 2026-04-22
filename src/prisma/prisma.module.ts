import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../generated/prisma/prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
