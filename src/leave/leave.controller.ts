import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClerkAuthGurad } from '../auth/auth.guard.js';
import { OrgGuard } from '../common/guards/org.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { CurrentUser } from '../auth/auth.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../common/types/index.js';
import { LeaveService } from './leave.service.js';
import {
  CreateLeaveDto,
  GetLeaveQueryDto,
  UpdateLeaveStatusDto,
} from './leave.dto.js';

@Controller('leave')
@UseGuards(ClerkAuthGurad, OrgGuard, RolesGuard)
export class LeaveController {
  private readonly logger = new Logger(LeaveController.name);

  constructor(private readonly leaveService: LeaveService) {}

  //GET /api/leave
  @Get()
  async getAllLeave(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetLeaveQueryDto,
  ) {
    this.logger.log(`Fetching leave requests for: ${user.email}`);
    return await this.leaveService.getAllLeave(user, query);
  }

  //POST /api/leave
  @Post()
  async requestLeave(
    @CurrentUser() user: AuthenticatedUser,
    @Body() data: CreateLeaveDto,
  ) {
    this.logger.log(`Leave request by: ${user.email}`);
    return await this.leaveService.requestLeave(user, data);
  }

  //PUT /api/leave/:id
  @Put(':id')
  @Roles('OWNER', 'ADMIN')
  async updateLeaveStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() data: UpdateLeaveStatusDto,
  ) {
    this.logger.log(`Updating leave ${id} by: ${user.email}`);
    return await this.leaveService.updateLeaveStatus(user, id, data);
  }

  //DELETE /api/leave/:id
  @Delete(':id')
  async cancelLeave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    this.logger.log(`Cancelling leave ${id} by: ${user.email}`);
    return await this.leaveService.cancelLeave(user, id);
  }
}
