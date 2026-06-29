import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  private getAllowlist(): string[] {
    return (process.env.SUPER_ADMIN_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice(7).trim();

    let payload;
    try {
      payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const clerkId = payload.sub;
    const allowlist = this.getAllowlist();
    // Fail closed: empty/unset allowlist denies everyone. Do not change this.
    if (allowlist.length === 0 || !clerkId || !allowlist.includes(clerkId)) {
      throw new ForbiddenException('Not a platform administrator');
    }

    req.superAdminId = clerkId;
    return true;
  }
}
