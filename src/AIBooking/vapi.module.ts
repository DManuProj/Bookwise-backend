import { Module } from '@nestjs/common';
import { VapiController } from './vapi.controller.js';
import { VapiService } from './vapi.service.js';

@Module({
  controllers: [VapiController],
  providers: [VapiService],
})
export class VapiModule {}
