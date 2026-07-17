import { Injectable } from '@nestjs/common';
import { startOfMonth } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  TIER_LIMITS,
  UNLIMITED,
} from '../common/constants/tier-limits.constant.js';

export type AvailabilityReason =
  | 'ORG_NOT_FOUND'
  | 'VOICE_DISABLED'
  | 'OVER_MONTHLY_LIMIT'
  | null;

export interface AvailabilityResult {
  available: boolean;
  reason: AvailabilityReason;
}

@Injectable()
export class VoiceService {
  constructor(private readonly prisma: PrismaService) {}

  // Public pre-call check for the booking page. Deliberately does NOT leak
  // usage numbers to anonymous callers — only a boolean + coarse reason.
  async getAvailability(slug: string): Promise<AvailabilityResult> {
    const org = await this.prisma.db.organisation.findUnique({
      where: { slug },
      select: { id: true, voiceAiEnabled: true, planTier: true },
    });

    // 1. Org not found
    if (!org) return { available: false, reason: 'ORG_NOT_FOUND' };

    // 2. Voice AI disabled for this org
    if (!org.voiceAiEnabled) {
      return { available: false, reason: 'VOICE_DISABLED' };
    }

    // 3. Unlimited tier → always available
    const cap = TIER_LIMITS[org.planTier].voiceMinutesPerMonth;
    if (cap === UNLIMITED) return { available: true, reason: null };

    // 4. Sum this month's usage and compare (duration is SECONDS, cap is MINUTES)
    const usage = await this.prisma.db.voiceUsage.aggregate({
      where: {
        orgId: org.id,
        createdAt: { gte: startOfMonth(new Date()) },
      },
      _sum: { duration: true },
    });

    const minutesUsed = Math.ceil((usage._sum.duration || 0) / 60);

    if (minutesUsed >= cap) {
      return { available: false, reason: 'OVER_MONTHLY_LIMIT' };
    }

    return { available: true, reason: null };
  }
}
