import { IsOptional, IsString } from 'class-validator';

export class UpdateCustomerNotesDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
