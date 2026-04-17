import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsNumber,
  MinLength,
  Min,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { WorkingHourDto } from '../onboarding/onboarding.dto.js';

export class UpdateOrganisationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  slug?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bufferMins?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minLeadTimeMins?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxPerSlot?: number;

  @IsOptional()
  @IsString()
  cancelPolicy?: string;
}

export class UpdateWorkingHoursDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkingHourDto)
  workingHours!: WorkingHourDto[];
}
