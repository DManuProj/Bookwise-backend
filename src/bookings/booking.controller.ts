import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorator.js';
import type { AuthenticatedUser } from '../common/types/index.js';
import { BookingService } from './booking.service.js';
import {
  CreateBookingDto,
  GetBookingSlotsDto,
  GetBookingsQueryDto,
  UpdateBookingDataDto,
  UpdateBookingStatusDto,
} from './booking.dto.js';
import { ClerkAuthGurad } from '../auth/auth.guard.js';
import { OrgGuard } from '../common/guards/org.guard.js';
import { BookingStatus } from '../generated/prisma/enums.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller('bookings')
@UseGuards(ClerkAuthGurad, OrgGuard, RolesGuard)
export class BookingController {
  private readonly logger = new Logger(BookingController.name);

  constructor(private readonly bookingService: BookingService) {}

  @Get()
  async getAllBookings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetBookingsQueryDto,
  ) {
    this.logger.log(`fetching bookings for ${user.email}`);
    return await this.bookingService.getAllBookings(user, query);
  }

  @Get('/slots')
  async getAvailableSlots(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetBookingSlotsDto,
  ) {
    return await this.bookingService.getAvailableSlots(user, query);
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  async createBooking(
    @CurrentUser() user: AuthenticatedUser,
    @Body() data: CreateBookingDto,
  ) {
    this.logger.log(`creating bookings for ${user.email}`);
    return await this.bookingService.createBooking(user, data);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  async updateBookingData(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() data: UpdateBookingDataDto,
  ) {
    this.logger.log(`updating bookings for ${user.email}`);
    return await this.bookingService.updateBookingData(user, id, data);
  }

  @Put(':id')
  @Roles('OWNER', 'ADMIN')
  async updateBookingStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() data: UpdateBookingStatusDto,
  ) {
    this.logger.log(`updating bookings for ${user.email}`);
    return await this.bookingService.updateBookingStatus(user, id, data);
  }
}
