import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsEmail,
  IsEnum,
  IsArray,
  ValidateNested,
  ValidateIf,
  MinLength,
  Min,
} from 'class-validator';
import { DayOfWeek, Role } from '../generated/prisma/enums.js';

// ── Working hour for one day
export class WorkingHourDto {
  @IsEnum(DayOfWeek)
  day!: DayOfWeek;

  @IsBoolean()
  isOpen!: boolean;

  @IsString()
  openTime!: string;

  @IsString()
  closeTime!: string;
}

// ── One staff member
export class StaffDto {
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsEnum(Role)
  role!: Role;
}

// ── One service
export class ServiceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  description?: string | null;

  @IsNumber()
  @Min(1)
  durationMins!: number;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsNumber()
  @Min(0)
  buffer!: number;
}

// ── Main onboarding body
export class OnboardingDto {
  @IsString()
  @IsNotEmpty()
  businessName!: string;

  @IsString()
  @MinLength(3)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  businessType!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  country!: string;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkingHourDto)
  workingHours!: WorkingHourDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffDto)
  staff!: StaffDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceDto)
  services!: ServiceDto[];
}
