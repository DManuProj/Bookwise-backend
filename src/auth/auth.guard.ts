import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClerkService } from './clerk.service.js';
import type { BootstrapUser } from '../common/types/index.js';

@Injectable()
export class ClerkAuthGurad implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGurad.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly clerkService: ClerkService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Step 1: Get the request object
    const request = context.switchToHttp().getRequest();

    // Step 2: Extract the token from the header
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }

    // Remove "Bearer " prefix to get just the token
    const token = authHeader.replace('Bearer ', '');

    // Step 3: Verify the token with Clerk — unchanged, still mandatory.
    // An invalid/expired/missing token 401s exactly as before.
    try {
      const payload = await verifyToken(token, {
        secretKey: this.config.get<string>('CLERK_SECRET_KEY'),
      });

      // payload.sub = the Clerk user ID (e.g. "user_3C5HTwHw...")
      // "sub" is a standard JWT field meaning "subject"
      // It identifies WHO the token belongs to
      const clerkId = payload.sub;

      // Step 4: Find the user in OUR database
      const user = await this.prisma.db.user.findUnique({
        where: { clerkId },
        include: { org: true }, // also fetch their organisation
      });

      // Step 5: Attach user to the request
      // Now any controller can access request.user
      if (user) {
        request.user = user;
        return true; // allow the request through
      }

      // Token is valid, only the DB row is missing (webhook delayed or lost).
      // Proceed in bootstrap mode so onboarding can provision the user instead
      // of dead-locking on 401. OrgGuard still blocks every org-scoped route
      // because orgId is null.
      this.logger.warn(
        `No DB user for clerkId: ${clerkId} — proceeding in bootstrap mode`,
      );

      request.user = await this.buildBootstrapUser(clerkId, payload);

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error('Token verification failed', error);
      throw new UnauthorizedException('Invalid token');
    }
  }

  // Build the bootstrap context from JWT claims when they carry identity,
  // otherwise from the Clerk API — default session tokens only carry `sub`.
  private async buildBootstrapUser(
    clerkId: string,
    payload: any,
  ): Promise<BootstrapUser> {
    const claimEmail =
      payload.email ?? payload.email_address ?? payload.primary_email ?? null;

    if (claimEmail) {
      return {
        isBootstrapping: true,
        clerkId,
        email: claimEmail,
        firstName: payload.first_name ?? payload.firstName ?? null,
        lastName: payload.last_name ?? payload.lastName ?? null,
        photoUrl: payload.image_url ?? payload.picture ?? null,
        orgId: null,
        org: null,
      };
    }

    const clerkUser = await this.clerkService.getUser(clerkId);
    const email = clerkUser.emailAddresses[0]?.emailAddress;

    if (!email) {
      this.logger.warn(`Clerk user ${clerkId} has no email address`);
      throw new UnauthorizedException('Clerk account has no email address');
    }

    return {
      isBootstrapping: true,
      clerkId,
      email,
      firstName: clerkUser.firstName ?? null,
      lastName: clerkUser.lastName ?? null,
      photoUrl: clerkUser.imageUrl ?? null,
      orgId: null,
      org: null,
    };
  }
}
