import { IsBoolean, IsEnum } from 'class-validator';
import { PlanTier } from '../../generated/prisma/enums.js';

export class ToggleVoiceAiDto {
  @IsBoolean()
  enabled!: boolean;
}

export class ChangePlanTierDto {
  @IsEnum(PlanTier)
  planTier!: PlanTier;
}
