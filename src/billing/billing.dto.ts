import { IsEnum, IsIn } from 'class-validator';
import { PlanTier } from '../generated/prisma/client.js';

export class SubscribeDto {
  @IsEnum(PlanTier)
  planTier!: PlanTier;

  @IsIn(['monthly', 'yearly'])
  billingPeriod!: 'monthly' | 'yearly';
}
