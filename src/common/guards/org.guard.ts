import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class OrgGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !user.orgId)
      throw new ForbiddenException('User has no organization');

    // Check if org is soft-deleted
    if (user.org?.isDeleted) {
      throw new ForbiddenException('Organisation has been deleted');
    }
    return true;
  }
}
