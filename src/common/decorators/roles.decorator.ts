import { SetMetadata } from '@nestjs/common';

// This decorator marks which roles can access a route
// Usage: @Roles('OWNER', 'ADMIN')
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
