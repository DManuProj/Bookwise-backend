import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ClerkAuthGurad } from '../auth/auth.guard.js';
import { OrgGuard } from '../common/guards/org.guard.js';
import { CurrentUser } from '../auth/auth.decorator.js';
import type { AuthenticatedUser } from '../common/types/index.js';
import { ServicesService } from './services.service.js';
import { CreateServiceDto, UpdateServiceDto } from './services.dto.js';

@Controller('services')
@UseGuards(ClerkAuthGurad, OrgGuard)
export class ServicesController {
  private readonly logger = new Logger(ServicesController.name);

  constructor(private readonly servicesService: ServicesService) {}

  //GET /api/services
  @Get()
  async getAllServices(@CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`Fetching services for: ${user.email}`);
    return await this.servicesService.getAllServices(user);
  }

  //POST /api/services
  @Post()
  async createService(
    @CurrentUser() user: AuthenticatedUser,
    @Body() data: CreateServiceDto,
  ) {
    this.logger.log(`Creating service for: ${user.email}`);
    return await this.servicesService.createService(user, data);
  }

  //PUT /api/services/:id
  @Put(':id')
  async updateService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() data: UpdateServiceDto,
  ) {
    this.logger.log(`Updating service ${id} for: ${user.email}`);
    return await this.servicesService.updateService(user, id, data);
  }

  //DELETE /api/services
  @Delete(':id')
  async deleteServices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    this.logger.log(`Deleting service ${id} for: ${user.email}`);
    return await this.servicesService.deleteService(user, id);
  }
}
