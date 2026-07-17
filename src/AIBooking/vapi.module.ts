import { Module } from '@nestjs/common';
import { VapiController } from './vapi.controller.js';
import { VapiService } from './vapi.service.js';
import { VoiceController } from './voice.controller.js';
import { VoiceService } from './voice.service.js';

@Module({
  controllers: [VapiController, VoiceController],
  providers: [VapiService, VoiceService],
})
export class VapiModule {}
