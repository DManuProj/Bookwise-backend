import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { BookingStatus } from '../generated/prisma/enums.js';

// Customer info — might be new or existing
export class BookingCustomerDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;
}

export class GetBookingSlotsDto {
  @IsString() @IsNotEmpty() serviceId!: string;
  @IsString() @IsNotEmpty() staffId!: string;
  @Type(() => Date) @IsDate() date!: Date;
  @IsOptional() @IsString() excludeBookingId?: string;
}

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsString()
  @IsNotEmpty()
  staffId!: string;

  @Type(() => Date) @IsDate() startAt!: Date;

  @IsOptional()
  @IsString()
  note?: string;

  // Customer — either existing ID or new customer details
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @Type(() => BookingCustomerDto)
  customer?: BookingCustomerDto;
}

export class UpdateBookingStatusDto {
  @IsEnum(BookingStatus)
  status!: BookingStatus;
}

// NEW — query params for GET /bookings
export class GetBookingsQueryDto {
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @IsOptional()
  @IsString()
  staffId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isStale?: boolean;
}

export class UpdateBookingDataDto {
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsString() staffId?: string;
  @IsOptional() @Type(() => Date) @IsDate() startAt?: Date;
  @IsOptional() @IsString() note?: string;
}
