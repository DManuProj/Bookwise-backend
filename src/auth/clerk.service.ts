import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, ClerkClient } from '@clerk/backend';

@Injectable()
export class ClerkService {
  private readonly logger = new Logger(ClerkService.name);
  private readonly clerk: ClerkClient;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.get<string>('CLERK_SECRET_KEY');

    if (!secretKey) {
      throw new Error('CLERK_SECRET_KEY is not set in env');
    }

    this.clerk = createClerkClient({ secretKey });
  }

  // Fetch a Clerk user by their clerkId
  async getUser(clerkId: string) {
    return await this.clerk.users.getUser(clerkId);
  }

  // Delete a Clerk user (used to clean up orphans on email mismatch)
  async deleteUser(clerkId: string) {
    await this.clerk.users.deleteUser(clerkId);
    this.logger.log(`Deleted Clerk user: ${clerkId}`);
  }
}
