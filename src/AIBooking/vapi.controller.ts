import { Body, Controller, Logger, Post } from '@nestjs/common';
import { VapiService } from './vapi.service.js';

@Controller('vapi')
export class VapiController {
  private readonly logger = new Logger(VapiController.name);

  constructor(private readonly vapiService: VapiService) {}

  // POST /api/vapi/webhook
  // Vapi calls this when the AI needs to run a function
  @Post('webhook')
  async handleVapiWebhook(@Body() data: any) {
    this.logger.log(`Vapi webhook: ${data.message?.type}`);
    return await this.vapiService.handleWebhook(data);
  }
}
