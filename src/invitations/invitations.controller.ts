import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InvitationsService } from './invitations.service.js';
import { AcceptInvitationDto } from './invitations.dto.js';
import { ClerkAuthGurad } from '../auth/auth.guard.js';
import { OrgGuard } from '../common/guards/org.guard.js';
import type { AuthenticatedUser } from '../common/types/index.js';
import { CurrentUser } from '../auth/auth.decorator.js';

@Controller('invitations')
export class InvitationsController {
  private readonly logger = new Logger(InvitationsController.name);

  constructor(private readonly invitationService: InvitationsService) {}

  //GET /api/invitations/:token
  @Get(':token')
  async getInvitation(@Param('token') token: string) {
    this.logger.log(`Fetching invitation`);
    return await this.invitationService.getInvitation(token);
  }

  // POST /api/invitations/:token/accept
  @Post('accept/:token')
  async acceptInvitation(
    @Param('token') token: string,
    @Body() data: AcceptInvitationDto,
  ) {
    this.logger.log(`Accepting invitation`);
    return await this.invitationService.acceptInvitation(token, data);
  }

  // POST /api/invitations/:id/resend  — PROTECTED (owners/admins only)
  @Post(':id/resend')
  @UseGuards(ClerkAuthGurad, OrgGuard)
  async reSendInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    this.logger.log(`Resend invitation by: ${user.email}`);
    return await this.invitationService.reSendInvitation(user, id);
  }

  // PATCH /api/invitations/:id/cancel  — PROTECTED (owners/admins only)
  @Patch(':id/cancel')
  @UseGuards(ClerkAuthGurad, OrgGuard)
  async cancelInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    this.logger.log(`Cancel invitation by: ${user.email}`);
    return await this.invitationService.cancelInvitation(user, id);
  }
}
