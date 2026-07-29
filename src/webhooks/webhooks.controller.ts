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

    // Errors deliberately propagate: a bad/missing secret surfaces as 400 and a
    // transient failure as 500 so Clerk retries. Swallowing them into a 200 hid
    // misconfiguration and meant new sign-ups were silently never provisioned.
    // Retries are safe — the handler upserts by clerkId.
    await this.webhooksService.handleClerkWebhook(rawBody.toString(), {
      'svix-id': headers['svix-id'],
      'svix-timestamp': headers['svix-timestamp'],
      'svix-signature': headers['svix-signature'],
    });

    return { success: true };
  }
}
