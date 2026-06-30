import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from './guards/super-admin.guard.js';
import { AdminService } from './admin.service.js';
import { ChangePlanTierDto, SuspendOrgDto, ToggleVoiceAiDto } from './dto/admin-actions.dto.js';

@Controller('admin')
@UseGuards(SuperAdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('ping')
  ping() {
    return { ok: true };
  }

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Get('organisations/:id/logs')
  getOrgAuditLogs(
    @Param('id') id: string,
    @Query('page') rawPage?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const page = Math.max(1, parseInt(rawPage ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(rawLimit ?? '20', 10) || 20));
    return this.adminService.getOrgAuditLogs(id, page, limit);
  }

  @Get('organisations/:id')
  getOrgDetail(@Param('id') id: string) {
    return this.adminService.getOrgDetail(id);
  }

  @Patch('organisations/:id/voice-ai')
  setVoiceAi(
    @Param('id') id: string,
    @Body() dto: ToggleVoiceAiDto,
    @Req() req: any,
  ) {
    return this.adminService.setVoiceAi(id, dto.enabled, req.superAdminId);
  }

  @Patch('organisations/:id/suspend')
  setSuspended(
    @Param('id') id: string,
    @Body() dto: SuspendOrgDto,
    @Req() req: any,
  ) {
    return this.adminService.setSuspended(id, dto.suspended, req.superAdminId);
  }

  @Patch('organisations/:id/plan-tier')
  setPlanTier(
    @Param('id') id: string,
    @Body() dto: ChangePlanTierDto,
    @Req() req: any,
  ) {
    return this.adminService.setPlanTier(id, dto.planTier, req.superAdminId);
  }

  @Get('users')
  getUsers(
    @Query('page') rawPage?: string,
    @Query('limit') rawLimit?: string,
    @Query('search') search?: string,
  ) {
    const page = Math.max(1, parseInt(rawPage ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(rawLimit ?? '20', 10) || 20));
    return this.adminService.getUsers(page, limit, search);
  }

  @Get('organisations')
  getOrganisations(
    @Query('page') rawPage?: string,
    @Query('limit') rawLimit?: string,
    @Query('search') search?: string,
  ) {
    const page = Math.max(1, parseInt(rawPage ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(rawLimit ?? '20', 10) || 20));
    return this.adminService.getOrganisations(page, limit, search);
  }
}
