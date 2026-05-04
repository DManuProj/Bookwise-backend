import { Global, Module } from '@nestjs/common';
import { ClerkAuthGurad } from './auth.guard.js';

@Global()
@Module({
  providers: [ClerkAuthGurad],
  exports: [ClerkAuthGurad],
})
export class AuthModule {}
