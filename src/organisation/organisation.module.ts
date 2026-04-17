import { Module } from '@nestjs/common';
import { OrganisationService } from './organisation.service.js';
import { OrganisationController } from './organisation.controller.js';

@Module({
  controllers: [OrganisationController],
  providers: [OrganisationService],
})
export class OrganisationModule {}
