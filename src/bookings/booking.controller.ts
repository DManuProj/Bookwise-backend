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
  GetBookingsQueryDto,
  UpdateBookingDto,
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

  @Post()
  @Roles('OWNER', 'ADMIN')
  async createBooking(
    @CurrentUser() user: AuthenticatedUser,
    @Body() data: CreateBookingDto,
  ) {
    this.logger.log(`creating bookings for ${user.email}`);
    return await this.bookingService.createBooking(user, data);
  }

  @Put(':id')
  @Roles('OWNER', 'ADMIN')
  async updateBooking(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() data: UpdateBookingDto,
  ) {
    this.logger.log(`updating bookings for ${user.email}`);
    return await this.bookingService.updateBooking(user, id, data);
  }
}
