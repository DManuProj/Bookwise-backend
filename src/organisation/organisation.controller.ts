import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ClerkAuthGurad } from '../auth/auth.guard.js';
import { OrgGuard } from '../common/guards/org.guard.js';
import { OrganisationService } from './organisation.service.js';
import { CurrentUser } from '../auth/auth.decorator.js';
import type { AuthenticatedUser } from '../common/types/index.js';
import {
  UpdateOrganisationDto,
  UpdateWorkingHoursDto,
} from './organisation.dto.js';
import { WorkingHourDto } from '../onboarding/onboarding.dto.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller('organisation')
@UseGuards(ClerkAuthGurad, OrgGuard, RolesGuard)
export class OrganisationController {
  private readonly logger = new Logger(OrganisationController.name);

  constructor(private readonly organisationService: OrganisationService) {}

  //GET /api/organisation

  @Get()
  async getOrganisation(@CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`Fetching org details for: ${user.email}`);
    return await this.organisationService.getOrganisation(user);
  }

  // PUT /api/organisation
  @Put()
  @Roles('OWNER', 'ADMIN')
  async updateOrganisation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() data: UpdateOrganisationDto,
  ) {
    this.logger.log(`Updating org for: ${user.email}`);
    return await this.organisationService.updateOrganisation(user, data);
  }

  // PUT /api/organisation/hours
  @Put('hours')
  @Roles('OWNER', 'ADMIN')
  async updateOrganisationHours(
    @CurrentUser() user: AuthenticatedUser,
    @Body() data: UpdateWorkingHoursDto,
  ) {
    this.logger.log(`Updating org hours for: ${user.email}`);

    return await this.organisationService.updateOrganisationHours(user, data);
  }

  @Delete()
  @Roles('OWNER')
  async deleteOrganisation(@CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`Delete request for org by: ${user.email}`);
    return await this.organisationService.deleteOrganisation(user);
  }
}
