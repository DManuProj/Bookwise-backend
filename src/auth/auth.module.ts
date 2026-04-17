import { Module } from '@nestjs/common';
import { ClerkAuthGurad } from './auth.guard.js';

@Module({
  providers: [ClerkAuthGurad],
  exports: [ClerkAuthGurad],
})
export class AuthModule {}
