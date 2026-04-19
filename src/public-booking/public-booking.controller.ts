import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PublicBoookingService } from './public-booking.service.js';
import { PublicCreateBookingDto } from './public-booking.dto.js';

@Controller('public')
export class PublicBookingController {
  private readonly logger = new Logger(PublicBookingController.name);

  constructor(private readonly publicBookingService: PublicBoookingService) {}

  // GET /api/public/:slug
  @Get(':slug')
  async getOrgBySlug(@Param('slug') slug: string) {
    this.logger.log(`Fetching public org data: ${slug}`);
    return await this.publicBookingService.getOrgBySlug(slug);
  }

  // GET /api/public/:slug/slots?serviceId=x&staffId=y&date=2026-04-18
  @Get(':slug/slots')
  async getAvailableSlots(
    @Param('slug') slug: string,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('staffId') staffId?: string,
  ) {
    this.logger.log(`Fetching slots for: ${slug}`);
    return await this.publicBookingService.getAvailableSlots(
      slug,
      serviceId,
      date,
      staffId,
    );
  }

  // POST /api/public/bookings
  @Post('bookings')
  async createPublicBooking(@Body() data: PublicCreateBookingDto) {
    this.logger.log(`Public booking request`);
    return await this.publicBookingService.createPublicBooking(data);
  }
}
