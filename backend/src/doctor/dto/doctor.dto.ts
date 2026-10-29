import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  AppointmentStatus,
  TestStatus,
} from '../../generated/prisma/client.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ListAppointmentsQuery {
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class UpdateAppointmentStatusDto {
  @IsEnum(AppointmentStatus)
  status: AppointmentStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class PrescriptionItemDto {
  @IsString()
  @MaxLength(200)
  medicationName: string;

  @IsOptional()
  @IsString()
  dosage?: string;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsString()
  duration?: string;
}

export class CreateRecordDto {
  @IsInt()
  appointmentId: number;

  @IsOptional()
  @IsInt()
  diagnosisId?: number;

  @IsOptional()
  @IsString()
  treatment?: string;

  @IsOptional()
  @IsString()
  prescription?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  prescriptions?: PrescriptionItemDto[];
}

export class UpdateRecordDto {
  @IsOptional()
  @IsInt()
  diagnosisId?: number;

  @IsOptional()
  @IsString()
  treatment?: string;

  @IsOptional()
  @IsString()
  prescription?: string;
}

export class UpdatePrescriptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  medicationName?: string;

  @IsOptional()
  @IsString()
  dosage?: string;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsString()
  duration?: string;
}

export class UpdateTestResultDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  testName?: string;

  @IsOptional()
  @IsString()
  resultDetails?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  testDate?: Date;

  @IsOptional()
  @IsEnum(TestStatus)
  status?: TestStatus;
}

export class CreateTestResultDto {
  @IsString()
  @MaxLength(200)
  testName: string;

  @IsOptional()
  @IsString()
  resultDetails?: string;

  @Type(() => Date)
  @IsDate()
  testDate: Date;

  @IsOptional()
  @IsEnum(TestStatus)
  status?: TestStatus;
}

export class CreateScheduleDto {
  @Type(() => Date)
  @IsDate()
  workDate: Date;

  /** HH:mm */
  @Matches(TIME_RE, { message: 'startTime must be HH:mm' })
  startTime: string;

  /** HH:mm */
  @Matches(TIME_RE, { message: 'endTime must be HH:mm' })
  endTime: string;
}
