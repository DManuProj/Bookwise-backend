import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { StaffModule } from '../staff/staff.module.js';

@Module({
  imports: [StaffModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
