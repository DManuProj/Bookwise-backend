import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBody,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service.js';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  // NestJS sees WebhooksService in the constructor
  // and automatically provides an instance of it
  // This is called "dependency injection"
  // You don't create it yourself — NestJS does it for you

  constructor(private readonly webhooksService: WebhooksService) {}

  // POST /api/webhooks/clerk
  // Clerk sends webhook here when events happen
  @Post('clerk')
  @HttpCode(200) // respond with 200 OK to acknowledge receipt
  async handleWebhook(
    @RawBody() rawBody: Buffer,
    @Headers() headers: Record<string, string>,
  ) {
    this.logger.log('Received Clerk webhook');

    try {
      // Pass raw body + headers to service
      // Controller doesn't verify or create users
      // It just receives and delegates
      await this.webhooksService.handleClerkWebhook(rawBody.toString(), {
        'svix-id': headers['svix-id'],
        'svix-timestamp': headers['svix-timestamp'],
        'svix-signature': headers['svix-signature'],
      });
      return { success: true };
    } catch (error) {
      this.logger.error('Webhook processing failed', error);
      return { success: false, error: 'Webhook processing failed' };
    }
  }
}
