import { IsString, IsNotEmpty } from 'class-validator';

export class AcceptInvitationDto {
  @IsString()
  @IsNotEmpty()
  clerkId!: string;
}
