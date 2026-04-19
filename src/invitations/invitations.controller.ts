import { Body, Controller, Get, Logger, Param, Post } from '@nestjs/common';
import { InvitationsService } from './invitations.service.js';
import { AcceptInvitationDto } from './invitations.dto.js';

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
    this.logger.log(`Fetching invitations`);
    return await this.invitationService.acceptInvitation(token, data);
  }
}
