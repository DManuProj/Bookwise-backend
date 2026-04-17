import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../generated/prisma/prisma.service.js';
import { verifyToken } from '@clerk/backend';

@Injectable()
export class ClerkAuthGurad implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGurad.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ── Step 1: Get the request object ────────────────
    const request = context.switchToHttp().getRequest();

    // ── Step 2: Extract the token from the header ─────
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }

    // Remove "Bearer " prefix to get just the token
    const token = authHeader.replace('Bearer ', '');

    // ── Step 3: Verify the token with Clerk ───────────

    try {
      const payload = await verifyToken(token, {
        secretKey: this.config.get<string>('CLERK_SECRET_KEY'),
      });

      // payload.sub = the Clerk user ID (e.g. "user_3C5HTwHw...")
      // "sub" is a standard JWT field meaning "subject"
      // It identifies WHO the token belongs to
      const clerkId = payload.sub;

      // ── Step 4: Find the user in OUR database ────────

      const user = await this.prisma.db.user.findUnique({
        where: { clerkId },
        include: { org: true }, // also fetch their organisation
      });

      if (!user) {
        this.logger.warn(`No user found for clerkId: ${clerkId}`);
        throw new UnauthorizedException('User not found');
      }

      // ── Step 5: Attach user to the request ───────────
      // Now any controller can access request.user
      request.user = user;

      return true; // allow the request through
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error('Token verification failed', error);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
