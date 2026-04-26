import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBody,
  UseGuards,
} from '@nestjs/common';
import { OrgGuard } from '../common/guards/org.guard.js';
import { CurrentUser } from '../auth/auth.decorator.js';
import type { AuthenticatedUser } from '../common/types/index.js';
import { BillingService } from './billing.service.js';
import { SubscribeDto } from './billing.dto.js';
import { ClerkAuthGurad } from '../auth/auth.guard.js';

@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(private readonly billingService: BillingService) {}

  // GET /api/billing/status
  @Get('status')
  @UseGuards(ClerkAuthGurad, OrgGuard)
  async getStatus(@CurrentUser() user: AuthenticatedUser) {
    return await this.billingService.getStatus(user);
  }

  // POST /api/billing/subscribe
  @Post('subscribe')
  @UseGuards(ClerkAuthGurad, OrgGuard)
  async subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() data: SubscribeDto,
  ) {
    this.logger.log(`Subscribe request from: ${user.email}`);
    return await this.billingService.subscribe(user, data);
  }

  // POST /api/billing/portal
  @Post('portal')
  @UseGuards(ClerkAuthGurad, OrgGuard)
  async createPortalSession(@CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`Portal request from: ${user.email}`);
    return await this.billingService.createPortalSession(user);
  }

  // POST /api/billing/webhook — NO auth guard (Stripe calls this)
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @RawBody() rawBody: Buffer,
    @Headers('stripe-signature') signature: string,
  ) {
    this.logger.log('Stripe webhook received');
    await this.billingService.handleWebhook(rawBody.toString(), signature);
    return { received: true };
  }
}
