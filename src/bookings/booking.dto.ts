import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
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

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsOptional()
  @IsString()
  staffId?: string;

  @Type(() => Date)
  @IsDate()
  startAt!: Date;

  @Type(() => Date)
  @IsDate()
  endAt!: Date;

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

export class UpdateBookingDto {
  @IsEnum(BookingStatus)
  status!: BookingStatus;
}
