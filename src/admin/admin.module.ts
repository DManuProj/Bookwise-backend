import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { SuperAdminGuard } from './guards/super-admin.guard.js';
import { StaffModule } from '../staff/staff.module.js';

@Module({
  imports: [StaffModule],
  controllers: [AdminController],
  providers: [SuperAdminGuard, AdminService],
})
export class AdminModule {}
