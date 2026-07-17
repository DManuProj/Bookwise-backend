import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
} from '@nestjs/common';
import { VoiceService } from './voice.service.js';

@Controller('voice')
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  constructor(private readonly voiceService: VoiceService) {}

  // GET /api/v1/voice/availability?slug=... — PUBLIC (no auth)
  @Get('availability')
  async getAvailability(@Query('slug') slug?: string) {
    if (!slug) {
      throw new BadRequestException('slug is required');
    }
    this.logger.log(`Voice availability check: ${slug}`);
    return await this.voiceService.getAvailability(slug);
  }
}
