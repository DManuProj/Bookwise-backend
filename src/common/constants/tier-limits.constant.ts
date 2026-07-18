import { ForbiddenException } from '@nestjs/common';
import { PlanTier } from '../../generated/prisma/enums.js';

// Mirrors frontend lib/plans.ts caps. KEEP IN SYNC.
// If you change a number here, change it in lib/plans.ts feature strings too.
export const UNLIMITED = Infinity;

export interface TierLimits {
  staff: number;
  services: number;
  bookingsPerMonth: number;
  voiceMinutesPerMonth: number;
}

export function checkTierCap(
  planTier: PlanTier,
  resource: keyof TierLimits,
  currentCount: number,
): void {
  const cap = TIER_LIMITS[planTier][resource];
  if (cap !== UNLIMITED && currentCount >= cap) {
    throw new ForbiddenException(
      `Your ${planTier} plan allows ${cap} ${resource}. Upgrade to add more.`,
    );
  }
}

export const TIER_LIMITS: Record<PlanTier, TierLimits> = {
  STARTER: {
    staff: 2,
    services: 10,
    bookingsPerMonth: 30,
    voiceMinutesPerMonth: 0,
  },
  PRO: {
    staff: 10,
    services: UNLIMITED,
    bookingsPerMonth: 100,
    voiceMinutesPerMonth: 100,
  },
  BUSINESS: {
    staff: UNLIMITED,
    services: UNLIMITED,
    bookingsPerMonth: UNLIMITED,
    voiceMinutesPerMonth: UNLIMITED,
  },
};
