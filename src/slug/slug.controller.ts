import { Controller, Get, Logger, Param } from '@nestjs/common';
import { SlugCheckingService } from './slug.service.js';

@Controller('slug-check')
export class SlugCheckingController {
  private readonly logger = new Logger(SlugCheckingController.name);

  constructor(private readonly slugService: SlugCheckingService) {}

  @Get(':slug')
  async slugCheck(@Param('slug') slug: string) {
    this.logger.log(`Checking slug availability: ${slug}`);
    return this.slugService.slugCheck(slug);
  }
}
