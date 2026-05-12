import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import { ClerkAuthGurad } from '../auth/auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { OrgGuard } from '../common/guards/org.guard.js';
import { CurrentUser } from '../auth/auth.decorator.js';
import type { AuthenticatedUser } from '../common/types/index.js';
import { OverviewService } from './overview.service.js';

@Controller('overview')
@UseGuards(ClerkAuthGurad, RolesGuard, OrgGuard)
export class OverviewController {
  private readonly logger = new Logger(OverviewController.name);

  constructor(private readonly overviewService: OverviewService) {}

  @Get()
  async getDashboardOverview(@CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`fetching dashboard overview`);
    return await this.overviewService.getDashboardOverview(user);
  }
}
