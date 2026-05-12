import { Module } from '@nestjs/common';
import { OverviewService } from './overview.service.js';
import { OverviewController } from './overview.controller.js';

@Module({
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
