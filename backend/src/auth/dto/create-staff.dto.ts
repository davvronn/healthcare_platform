import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from '../../generated/prisma/client.js';
import { RegisterDto } from './register.dto.js';

export class CreateStaffDto extends RegisterDto {
  @IsEnum(Role)
  role: Role;

  @IsOptional()
  @IsString()
  specialization?: string;

  @IsOptional()
  @IsString()
  licenseNumber?: string;
}
