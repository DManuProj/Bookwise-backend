import { Injectable, Logger } from '@nestjs/common';
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
    // ── Step 1: Verify the webhook signature ──────────
    // Make sure this request is genuinely from Clerk
    const secret = this.config.get<string>('CLERK_WEBHOOK_SECRET');

    if (!secret) {
      this.logger.error('CLERK_WEBHOOK_SECRET is not set in .env');
      throw new Error('Webhook secret not configured');
    }

    let event: any;

    try {
      // Svix takes the secret, raw body, and headers
      // Runs the math formula and checks the signature
      const wh = new Webhook(secret);
      event = wh.verify(rawBody, headers) as any;
    } catch (error) {
      this.logger.error('Webhook signature verification failed', error);
      throw new Error('Invalid webhook signature');
    }

    // ── Step 2: Handle the event ──────────────────────
    this.logger.log(`Clerk event received: ${event.type}`);

    switch (event.type) {
      case 'user.created':
        await this.handleUserCreated(event.data);
        break;

      case 'user.updated':
        await this.handleUserUpdated(event.data);
        break;

      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
    }
  }

  // ── Step 3: Create user in our database ─────────────
  private async handleUserCreated(data: any) {
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

    // Check if user already exists (prevent duplicates)
    const existingUser = await this.prisma.db.user.findUnique({
      where: { clerkId: id },
    });

    if (existingUser) {
      this.logger.log(`User already exists: ${email}`);
      return;
    }

    const user = await this.prisma.db.user.create({
      data: {
        clerkId: id,
        email,
        firstName: first_name || null,
        lastName: last_name || null,
        photoUrl: image_url || null,
        role: 'OWNER',
        status: 'INACTIVE',
        profileComplete: false,
        onboardingComplete: false,
      },
    });

    this.logger.log(`User created: ${user.email} (clerkId: ${user.clerkId})`);
  }

  private async handleUserUpdated(data: any) {
    const { id, first_name, last_name, image_url } = data;

    // Find the DB user by clerkId
    const existingUser = await this.prisma.db.user.findUnique({
      where: { clerkId: id },
    });

    if (!existingUser) {
      this.logger.log(
        `User.updated webhook for unknown clerkId: ${id}, skipping`,
      );
      return;
    }

    await this.prisma.db.user.update({
      where: { clerkId: id },
      data: {
        firstName: first_name || existingUser.firstName,
        lastName: last_name || existingUser.lastName,
        photoUrl: image_url || existingUser.photoUrl,
      },
    });

    this.logger.log(
      `User profile synced: ${existingUser.email} (clerkId: ${id})`,
    );
  }
}
