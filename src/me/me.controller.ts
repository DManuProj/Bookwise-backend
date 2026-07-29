import { Body, Controller, Get, Logger, Put, UseGuards } from '@nestjs/common';
import { ClerkAuthGurad } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/auth.decorator.js';
import type { RequestUser } from '../common/types/index.js';
import { MeService } from './me.service.js';
import { UpdateMeDto } from './me.dto.js';

@Controller('me')
@UseGuards(ClerkAuthGurad)
export class MeController {
  private readonly logger = new Logger(MeController.name);

  constructor(private readonly meService: MeService) {}

  @Get()
  async getMe(@CurrentUser() user: RequestUser) {
    this.logger.log(`Fetching profile for: ${user.email}`);
    return await this.meService.getMe(user);
  }

  @Put()
  async updateMe(
    @CurrentUser() user: RequestUser,
    @Body() data: UpdateMeDto,
  ) {
    this.logger.log(`Updating profile for: ${user.email}`);
    return await this.meService.updateMe(user, data);
  }
}
