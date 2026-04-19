import { Module } from '@nestjs/common';
import { PublicBookingController } from './public-booking.controller.js';
import { PublicBoookingService } from './public-booking.service.js';

@Module({
  controllers: [PublicBookingController],
  providers: [PublicBoookingService],
})
export class PublicBookingModule {}
