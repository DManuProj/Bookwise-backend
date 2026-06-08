import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class PublicCustomerDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() email!: string;
  @IsString() @IsNotEmpty() phone!: string;
}

export class PublicCreateBookingDto {
  @IsString() @IsNotEmpty() slug!: string;
  @IsString() @IsNotEmpty() serviceId!: string;

  @IsOptional() @IsString() staffId?: string;

  // YYYY-MM-DD (org-local calendar day)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  // HH:MM 24h (org-local wall-clock)
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'time must be HH:MM' })
  time!: string;

  @IsOptional() @IsString() note?: string;

  @ValidateNested() @Type(() => PublicCustomerDto) customer!: PublicCustomerDto;
}
