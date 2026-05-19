import {
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { VapiService } from './vapi.service.js';

@Controller('vapi')
export class VapiController {
  private readonly logger = new Logger(VapiController.name);

  constructor(private readonly vapiService: VapiService) {}

  @Post('webhook')
  async handleVapiWebhook(
    @Body() data: any,
    @Headers('x-vapi-secret') secret: string,
  ) {
    if (!secret || secret !== process.env.VAPI_WEBHOOK_SECRET) {
      this.logger.warn('Vapi webhook auth failed');
      throw new UnauthorizedException('Invalid webhook secret');
    }

    this.logger.log(`Vapi webhook: ${data.message?.type}`);
    return await this.vapiService.handleWebhook(data);
  }
}
