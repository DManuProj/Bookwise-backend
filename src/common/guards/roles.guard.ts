import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get the roles set by @Roles() decorator
    const requiredRoles = this.reflector.get<string[]>(
      'roles',
      context.getHandler(),
    );

    // If no @Roles() decorator → allow everyone
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Get user from request (set by auth guard)
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Check if user's role is in the allowed list
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Requires ${requiredRoles.join(' or ')} role`,
      );
    }

    return true;
  }
}
