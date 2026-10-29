import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { Roles } from '../auth/roles.decorator.js';
import { PageQuery, paged, paginate } from '../common/page.dto.js';
import {
  AppointmentStatus,
  Role,
  TestStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
} as const;

class NurseAppointmentsQuery extends PageQuery {
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  doctorId?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

class NurseStatusDto {
  @IsEnum(AppointmentStatus)
  status: AppointmentStatus;
}

class NursePatientsQuery extends PageQuery {
  @IsOptional()
  @IsString()
  search?: string;
}

class NurseTestResultsQuery extends PageQuery {
  @IsOptional()
  @IsEnum(TestStatus)
  status?: TestStatus;
}

class NurseUpdateTestResultDto {
  @IsOptional()
  @IsString()
  resultDetails?: string;

  @IsOptional()
  @IsEnum(TestStatus)
  status?: TestStatus;
}

/** Nurse-only API: reception (confirm/cancel bookings) and lab results. */
@Roles(Role.NURSE)
@Controller('nurse')
export class NurseController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('appointments')
  async appointments(@Query() q: NurseAppointmentsQuery) {
    const where = {
      status: q.status,
      doctorId: q.doctorId,
      appointmentDate: { gte: q.from, lte: q.to },
    };
    const [items, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        include: {
          patient: { select: personSelect },
          doctor: {
            select: {
              staffId: true,
              specialization: true,
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { appointmentDate: 'asc' },
        ...paginate(q),
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return paged(items, total, q);
  }

  /** Reception can only confirm or cancel bookings that are still pending. */
  @Patch('appointments/:id/status')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: NurseStatusDto,
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    const allowed: AppointmentStatus[] = ['CONFIRMED', 'CANCELLED'];
    if (
      appointment.status !== AppointmentStatus.PENDING ||
      !allowed.includes(dto.status)
    ) {
      throw new BadRequestException(
        `Cannot change status from ${appointment.status} to ${dto.status}`,
      );
    }
    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: dto.status },
    });
    await this.prisma.notification.create({
      data: {
        userId: appointment.patientId,
        appointmentId: id,
        title: `Appointment ${dto.status.toLowerCase()}`,
        message: `Appointment on ${appointment.appointmentDate.toISOString()}`,
      },
    });
    return updated;
  }

  @Get('patients')
  async patients(@Query() q: NursePatientsQuery) {
    const where = {
      role: Role.PATIENT,
      ...(q.search && {
        OR: [
          { firstName: { contains: q.search, mode: 'insensitive' as const } },
          { lastName: { contains: q.search, mode: 'insensitive' as const } },
          { phone: { contains: q.search } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { ...personSelect, gender: true, dateOfBirth: true },
        orderBy: { lastName: 'asc' },
        ...paginate(q),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paged(items, total, q);
  }

  @Get('test-results')
  async testResults(@Query() q: NurseTestResultsQuery) {
    const where = { status: q.status };
    const [items, total] = await Promise.all([
      this.prisma.testResult.findMany({
        where,
        include: {
          record: { select: { id: true, patient: { select: personSelect } } },
        },
        orderBy: { testDate: 'desc' },
        ...paginate(q),
      }),
      this.prisma.testResult.count({ where }),
    ]);
    return paged(items, total, q);
  }

  @Patch('test-results/:id')
  async updateTestResult(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: NurseUpdateTestResultDto,
  ) {
    const existing = await this.prisma.testResult.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Test result not found');
    return this.prisma.testResult.update({ where: { id }, data: dto });
  }
}
