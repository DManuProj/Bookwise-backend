import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { AuthenticatedUser } from '../common/types/index.js';
import { SubscribeDto } from './billing.dto.js';
import Stripe from 'stripe';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe;
  private readonly priceMap: Record<string, string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {
    // Initialize Stripe with secret key
    this.stripe = new Stripe(this.config.get<string>('STRIPE_SECRET_KEY')!);

    // Map plan tiers to Stripe price IDs
    this.priceMap = {
      PRO_monthly: this.config.get<string>('STRIPE_PRO_PRICE_ID')!,
      PRO_yearly: this.config.get<string>('STRIPE_PRO_YEARLY_PRICE_ID')!,
      BUSINESS_monthly: this.config.get<string>('STRIPE_BUSINESS_PRICE_ID')!,
      BUSINESS_yearly: this.config.get<string>(
        'STRIPE_BUSINESS_YEARLY_PRICE_ID',
      )!,
    };
  }

  // ── GET /api/billing/status ─────────────────────────
  // Returns current plan and subscription info
  async getStatus(user: AuthenticatedUser) {
    const org = await this.prisma.db.organisation.findUnique({
      where: { id: user.orgId! },
    });

    return {
      success: true,
      data: {
        planTier: org?.planTier || 'STARTER',
        stripeCustomerId: org?.stripeCustomerId || null,
        hasSubscription: !!org?.stripeSubscriptionId,
      },
    };
  }

  // ── POST /api/billing/subscribe ─────────────────────
  // Creates or updates a subscription
  // Returns clientSecret for frontend to confirm payment
  async subscribe(user: AuthenticatedUser, data: SubscribeDto) {
    // Only owner can manage billing
    if (user.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can manage billing');
    }

    // Can't subscribe to Starter (it's free)
    if (data.planTier === 'STARTER') {
      throw new BadRequestException(
        'Use cancel endpoint to downgrade to Starter',
      );
    }

    const org = await this.prisma.db.organisation.findUnique({
      where: { id: user.orgId! },
    });

    if (!org) throw new BadRequestException('Organisation not found');

    const priceId = this.priceMap[`${data.planTier}_${data.billingPeriod}`];

    if (!priceId) throw new BadRequestException('Invalid plan');

    // Step 1: Create or get Stripe customer
    let stripeCustomerId = org.stripeCustomerId;

    if (!stripeCustomerId) {
      // First time subscribing — create Stripe customer
      const customer = await this.stripe.customers.create({
        email: user.email,
        name: org.name,
        metadata: {
          orgId: org.id,
          userId: user.id,
        },
      });

      stripeCustomerId = customer.id;

      // Save Stripe customer ID to our database
      await this.prisma.db.organisation.update({
        where: { id: org.id },
        data: { stripeCustomerId },
      });

      this.logger.log(`Stripe customer created: ${stripeCustomerId}`);
    }

    // Step 2: Check if they already have a subscription
    if (org.stripeSubscriptionId) {
      // Upgrading or downgrading — update existing subscription
      const subscription = await this.stripe.subscriptions.retrieve(
        org.stripeSubscriptionId,
      );

      const updatedSubscription = await this.stripe.subscriptions.update(
        org.stripeSubscriptionId,
        {
          items: [
            {
              id: subscription.items.data[0].id,
              price: priceId,
            },
          ],
          proration_behavior: 'always_invoice',
          metadata: {
            orgId: org.id,
            planTier: data.planTier,
          },
        },
      );

      this.logger.log(`Subscription updated to ${data.planTier}`);

      return {
        success: true,
        message: `Plan updated to ${data.planTier}`,
        data: {
          subscriptionId: updatedSubscription.id,
          // No clientSecret needed — existing payment method used
        },
      };
    }

    // Step 3: New subscription — create with incomplete status
    // Frontend will confirm payment with Stripe Elements
    const subscription = await this.stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      metadata: {
        orgId: org.id,
        planTier: data.planTier,
      },
      expand: ['latest_invoice.payment_intent'],
    });

    // Get the client secret for frontend to confirm payment
    const invoice = subscription.latest_invoice as Stripe.Invoice;
    const clientSecret = invoice.confirmation_secret?.client_secret;
    if (!clientSecret) {
      throw new BadRequestException(
        'Unable to create payment confirmation secret',
      );
    }

    this.logger.log(
      `Subscription created: ${subscription.id} (pending payment)`,
    );

    return {
      success: true,
      data: {
        subscriptionId: subscription.id,
        clientSecret: clientSecret,
      },
    };
  }

  // ── POST /api/billing/portal ────────────────────────
  // Creates a Stripe Customer Portal session
  // User can manage payment methods, view invoices, cancel
  async createPortalSession(user: AuthenticatedUser) {
    if (user.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can manage billing');
    }

    const org = await this.prisma.db.organisation.findUnique({
      where: { id: user.orgId! },
    });

    if (!org?.stripeCustomerId) {
      throw new BadRequestException('No billing account found');
    }

    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';

    const session = await this.stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${frontendUrl}/dashboard/settings`,
    });

    return { success: true, data: { url: session.url } };
  }

  // ── POST /api/billing/webhook ───────────────────────
  // Stripe sends events here when payment status changes
  async handleWebhook(rawBody: string, signature: string) {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');

    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET not set');
      throw new BadRequestException('Webhook secret not configured');
    }

    let event: Stripe.Event;

    // Verify the webhook signature (same concept as Clerk webhook)
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (error) {
      this.logger.error('Stripe webhook signature verification failed');
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log(`Stripe event: ${event.type}`);

    switch (event.type) {
      // Payment succeeded — activate the subscription
      case 'invoice.payment_succeeded':
        await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      // Subscription updated (upgrade/downgrade)
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      // Subscription cancelled
      case 'customer.subscription.deleted':
        await this.handleSubscriptionCancelled(
          event.data.object as Stripe.Subscription,
        );
        break;

      default:
        this.logger.log(`Unhandled Stripe event: ${event.type}`);
    }
  }

  // ── Payment succeeded — activate plan
  private async handlePaymentSucceeded(invoice: Stripe.Invoice) {
    const subscriptionRef =
      invoice.parent?.type === 'subscription_details'
        ? invoice.parent.subscription_details?.subscription
        : null;

    const subscriptionId =
      typeof subscriptionRef === 'string'
        ? subscriptionRef
        : subscriptionRef?.id;

    if (!subscriptionId) return;

    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);

    const orgId = subscription.metadata.orgId;
    const planTier = subscription.metadata.planTier;

    if (!orgId || !planTier) {
      this.logger.warn('Missing metadata on subscription');
      return;
    }

    await this.prisma.db.organisation.update({
      where: { id: orgId },
      data: {
        planTier: planTier as any,
        stripeSubscriptionId: subscriptionId,
      },
    });

    this.logger.log(`Plan activated: ${orgId} → ${planTier}`);
  }

  // ── Subscription updated (plan change) ──────────────
  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const orgId = subscription.metadata.orgId;
    if (!orgId) return;

    // Get the current price to determine plan tier
    const priceId = subscription.items.data[0]?.price.id;

    let planTier = 'STARTER';
    if (
      priceId === this.priceMap['PRO_monthly'] ||
      priceId === this.priceMap['PRO_yearly']
    ) {
      planTier = 'PRO';
    }
    if (
      priceId === this.priceMap['BUSINESS_monthly'] ||
      priceId === this.priceMap['BUSINESS_yearly']
    ) {
      planTier = 'BUSINESS';
    }

    await this.prisma.db.organisation.update({
      where: { id: orgId },
      data: {
        planTier: planTier as any,
        stripeSubscriptionId: subscription.id,
      },
    });

    this.logger.log(`Subscription updated: ${orgId} → ${planTier}`);
  }

  // ── Payment failed — notify org owner ──────────────
  private async handlePaymentFailed(invoice: Stripe.Invoice) {
    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id;

    if (!customerId) return;

    const org = await this.prisma.db.organisation.findUnique({
      where: { stripeCustomerId: customerId },
      include: {
        users: {
          where: { role: 'OWNER', status: 'ACTIVE' },
          take: 1,
        },
      },
    });

    if (!org || !org.users[0]) {
      this.logger.warn(`No org/owner found for Stripe customer: ${customerId}`);
      return;
    }

    const owner = org.users[0];
    const billingUrl = `${this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/dashboard/settings`;

    await this.emailService.sendPaymentFailedEmail(
      owner.email,
      org.name,
      billingUrl,
    );

    this.logger.warn(`Payment failed for org: ${org.name} (${customerId})`);
  }

  // ── Subscription cancelled ──────────────────────────
  private async handleSubscriptionCancelled(subscription: Stripe.Subscription) {
    const orgId = subscription.metadata.orgId;
    if (!orgId) return;

    await this.prisma.db.organisation.update({
      where: { id: orgId },
      data: {
        planTier: 'STARTER',
        stripeSubscriptionId: null,
      },
    });

    this.logger.log(`Subscription cancelled: ${orgId} → STARTER`);
  }
}
