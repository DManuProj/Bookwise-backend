import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { Role } from '../generated/prisma/enums.js';

// export class InviteStaffDto {
//   @Type(() => StaffDto)
//   staff!: StaffDto;
// }

export class ChangeRoleDto {
  @IsEnum(Role)
  role!: Role;
}
