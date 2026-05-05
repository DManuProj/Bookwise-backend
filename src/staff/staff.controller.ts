import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ClerkAuthGurad } from '../auth/auth.guard.js';
import { OrgGuard } from '../common/guards/org.guard.js';
import { StaffService } from './staff.service.js';
import { CurrentUser } from '../auth/auth.decorator.js';
import type { AuthenticatedUser } from '../common/types/index.js';
import { ChangeRoleDto } from './staff.dto.js';
import { StaffDto } from '../onboarding/onboarding.dto.js';

@Controller('staff')
@UseGuards(ClerkAuthGurad, OrgGuard)
export class StaffController {
  private readonly logger = new Logger(StaffController.name);

  constructor(private readonly staffService: StaffService) {}

  //GET /api/staff
  @Get()
  async getAllStaff(@CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`Fetching staff  for: ${user.email}`);
    return await this.staffService.getAllStaff(user);
  }

  // POST /api/staff/invite
  @Post('invite')
  async inviteStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Body() data: StaffDto, // → InviteStaffDto
  ) {
    this.logger.log(`send invitation for: ${user.email}`);
    return await this.staffService.inviteStaff(user, data);
  }

  //PUT /api/staff/:id/role
  @Put(':id/role')
  async changeStaffRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() data: ChangeRoleDto,
  ) {
    this.logger.log(` Changing role for staff ${id} by: ${user.email}`);
    return await this.staffService.changeStaffRole(user, id, data);
  }

  //DELETE /api/staff/:id
  @Delete(':id')
  async deleteStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    this.logger.log(` Removing staff ${id} by: ${user.email}`);
    return await this.staffService.deleteStaff(user, id);
  }
}
