import { Global, Module } from '@nestjs/common';
import { ClerkAuthGurad } from './auth.guard.js';
import { ClerkService } from './clerk.service.js';

@Global()
@Module({
  providers: [ClerkAuthGurad, ClerkService],
  exports: [ClerkAuthGurad, ClerkService],
})
export class AuthModule {}
