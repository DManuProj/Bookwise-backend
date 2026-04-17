// Custom decorator that extracts user from request

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Usage: @CurrentUser() user in any controller method
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user; // set by ClerkAuthGuard
  },
);
