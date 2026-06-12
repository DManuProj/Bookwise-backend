import { IsDate, IsEnum, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { LeaveStatus } from '../generated/prisma/client.js';

export class CreateLeaveDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be YYYY-MM-DD' })
  endDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateLeaveStatusDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';
}

export class GetLeaveQueryDto {
  @IsOptional()
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;

  @IsOptional()
  @IsString()
  userId?: string;
}