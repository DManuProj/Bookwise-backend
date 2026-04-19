// public-booking.dto.ts
import { Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class PublicCustomerDto {
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

export class PublicCreateBookingDto {
  @IsString()
  @IsNotEmpty()
  slug!: string;

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

  @ValidateNested()
  @Type(() => PublicCustomerDto)
  customer!: PublicCustomerDto;
}
