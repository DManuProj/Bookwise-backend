import { Module } from '@nestjs/common';
import { SlugCheckingController } from './slug.controller.js';
import { SlugCheckingService } from './slug.service.js';

@Module({
  controllers: [SlugCheckingController],
  providers: [SlugCheckingService],
})
export class SlugCheckingModule {}
