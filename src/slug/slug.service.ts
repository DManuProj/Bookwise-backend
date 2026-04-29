import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SlugCheckingService {
  constructor(private readonly prisma: PrismaService) {}

  async slugCheck(slug: string) {
    const existing = await this.prisma.db.organisation.findUnique({
      where: { slug },
      select: { id: true },
    });

    return { available: !existing };
  }
}
