import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClerkAuthGurad } from '../auth/auth.guard.js';
import { OrgGuard } from '../common/guards/org.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { CustomerService } from './customer.service.js';
import { CurrentUser } from '../auth/auth.decorator.js';
import type { AuthenticatedUser } from '../common/types/index.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UpdateCustomerNotesDto } from './customer.dto.js';

@Controller('customers')
@UseGuards(ClerkAuthGurad, OrgGuard, RolesGuard)
export class CustomerController {
  private readonly logger = new Logger(CustomerController.name);

  constructor(private readonly customerService: CustomerService) {}

  // GET /api/customers?name=Sarah&email=sarah@...
  @Get()
  @Roles('OWNER', 'ADMIN')
  async getAllCustomers(
    @CurrentUser() user: AuthenticatedUser,
    @Query('name') name?: string,
    @Query('email') email?: string,
  ) {
    this.logger.log(`fetching customers for ${user.email}`);

    return await this.customerService.getAllCustomers(user, name, email);
  }

  // GET /api/customers/:id
  @Get(':id')
  @Roles('OWNER', 'ADMIN')
  async getCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    this.logger.log(`Fetching customer ${id} for: ${user.email}`);

    return await this.customerService.getCustomer(user, id);
  }

  // PUT /api/customers/:id/notes
  @Put('/:id/notes')
  @Roles('OWNER', 'ADMIN')
  async updateCustomerNotes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() data: UpdateCustomerNotesDto,
  ) {
    this.logger.log(`Updating notes for customer ${id} by: ${user.email}`);

    return await this.customerService.updateCustomerNotes(user, id, data);
  }
}
