import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClerkAuthGurad } from '../auth/auth.guard.js';
import { OnboardingService } from './onboarding.service.js';
import { CurrentUser } from '../auth/auth.decorator.js';
import { OnboardingDto } from './onboarding.dto.js';
import type { AuthenticatedUser } from '../common/types/index.js';

@Controller('onboarding')
@UseGuards(ClerkAuthGurad)
export class OnboardingController {
  private readonly logger = new Logger(OnboardingController.name);

  constructor(private readonly onboardingService: OnboardingService) {}

  // POST /api/onboarding
  @Post()
  @HttpCode(200)
  async handleOnboarding(
    @CurrentUser() user: AuthenticatedUser, // the logged-in user (from auth guard)
    @Body() data: OnboardingDto, // the onboarding data from frontend
  ) {
    this.logger.log(`Onboarding started for: ${user.email}`);
    return await this.onboardingService.completeOnboarding(user, data);
  }
}
