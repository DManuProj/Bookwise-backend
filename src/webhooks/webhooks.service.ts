import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Webhook } from 'svix';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async handleClerkWebhook(rawBody: string, headers: Record<string, string>) {
    // Step 1: Verify the webhook signature
    // Make sure this request is genuinely from Clerk
    const secret = this.config.get<string>('CLERK_WEBHOOK_SECRET');

    if (!secret) {
      this.logger.error(
        'CLERK_WEBHOOK_SECRET is not set — cannot verify Clerk webhooks. ' +
          'New sign-ups will not be provisioned until this env var is configured.',
      );
      throw new BadRequestException('Webhook secret not configured');
    }

    let event: any;

    try {
      // Svix takes the secret, raw body, and headers
      // Runs the math formula and checks the signature
      const wh = new Webhook(secret);
      event = wh.verify(rawBody, headers) as any;
    } catch (error) {
      this.logger.error('Webhook signature verification failed', error);
      throw new BadRequestException('Invalid webhook signature');
    }

    // Step 2: Handle the event
    this.logger.log(`Clerk event received: ${event.type}`);

    switch (event.type) {
      case 'user.created':
      case 'user.updated':
        await this.upsertUserFromClerk(event.data, event.type);
        break;

      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
    }
  }

  // Step 3: Create/sync the user in our database.
  // Upsert by clerkId so Clerk's retries (common after a cold start) are safe —
  // a duplicate delivery updates instead of blowing up with a unique violation.
  // Never creates an Organisation; that happens during onboarding.
  private async upsertUserFromClerk(data: any, eventType: string) {
    const { id, email_addresses, first_name, last_name, image_url } = data;

    // Clerk stores emails in an array
    // The primary email is the first one
    const email = email_addresses?.[0]?.email_address;

    if (!email) {
      this.logger.error(`No email found for Clerk user: ${id}`);
      return;
    }

    const pendingInvitation = await this.prisma.db.staffInvitation.findFirst({
      where: {
        email,
        status: { in: ['PENDING', 'RESENT'] },
      },
    });

    if (pendingInvitation) {
      this.logger.log(
        `Pending invitation exists for ${email}, skipping webhook user creation. Accept endpoint will handle it.`,
      );
      return;
    }

    // Match on clerkId OR email: when a Clerk account is deleted and recreated
    // the same person arrives with a NEW clerkId, and creating on clerkId alone
    // then violates the unique email constraint.
    const existing = await this.prisma.db.user.findFirst({
      where: { OR: [{ clerkId: id }, { email }] },
    });

    try {
      if (!existing) {
        // firstName/lastName are non-nullable columns — fall back to ''
        const created = await this.prisma.db.user.create({
          data: {
            clerkId: id,
            email,
            firstName: first_name || '',
            lastName: last_name || '',
            photoUrl: image_url || null,
            role: 'OWNER',
            status: 'INACTIVE',
            profileComplete: false,
            onboardingComplete: false,
          },
        });

        this.logger.log(
          `User created from ${eventType}: ${created.email} (clerkId: ${created.clerkId})`,
        );
        return;
      }

      // Re-point clerkId if Clerk reissued the account, and sync profile fields
      // (undefined = leave unchanged). Email is deliberately not synced — it
      // could collide with a different row's unique email.
      const synced = await this.prisma.db.user.update({
        where: { id: existing.id },
        data: {
          clerkId: id,
          firstName: first_name || undefined,
          lastName: last_name || undefined,
          photoUrl: image_url || undefined,
        },
      });

      this.logger.log(
        `User synced from ${eventType}: ${synced.email} (clerkId: ${synced.clerkId})`,
      );
    } catch (err) {
      // A duplicate isn't transient — retrying can't fix it, so ack and stop
      // Clerk from redelivering forever.
      if ((err as any).code === 'P2002') {
        this.logger.warn(
          `Duplicate user for ${email} (clerkId: ${id}) on ${eventType} — skipping`,
        );
        return;
      }
      throw err;
    }
  }
}
