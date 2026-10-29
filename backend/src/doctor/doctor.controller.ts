import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { type AuthUser, CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { Role } from '../generated/prisma/client.js';
import {
  CreateRecordDto,
  CreateScheduleDto,
  CreateTestResultDto,
  ListAppointmentsQuery,
  PrescriptionItemDto,
  UpdateAppointmentStatusDto,
  UpdatePrescriptionDto,
  UpdateRecordDto,
  UpdateTestResultDto,
} from './dto/doctor.dto.js';
import { DoctorService } from './doctor.service.js';

/** Doctor-only API: every route here requires the DOCTOR role. */
@Roles(Role.DOCTOR)
@Controller('doctor')
export class DoctorController {
  constructor(private readonly doctor: DoctorService) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.doctor.profile(user.id);
  }

  @Get('appointments')
  appointments(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAppointmentsQuery,
  ) {
    return this.doctor.appointments(user.id, query);
  }

  @Get('appointments/:id')
  appointment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.doctor.appointment(user.id, id);
  }

  @Patch('appointments/:id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAppointmentStatusDto,
  ) {
    return this.doctor.updateAppointmentStatus(user.id, id, dto);
  }

  @Get('patients')
  patients(@CurrentUser() user: AuthUser) {
    return this.doctor.patients(user.id);
  }

  @Get('patients/:id/records')
  patientRecords(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) patientId: number,
  ) {
    return this.doctor.patientRecords(user.id, patientId);
  }

  @Post('records')
  createRecord(@CurrentUser() user: AuthUser, @Body() dto: CreateRecordDto) {
    return this.doctor.createRecord(user.id, dto);
  }

  @Get('records')
  records(@CurrentUser() user: AuthUser) {
    return this.doctor.records(user.id);
  }

  @Get('records/:id')
  record(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.doctor.record(user.id, id);
  }

  @Patch('records/:id')
  updateRecord(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRecordDto,
  ) {
    return this.doctor.updateRecord(user.id, id, dto);
  }

  @Post('records/:id/prescriptions')
  addPrescription(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) recordId: number,
    @Body() dto: PrescriptionItemDto,
  ) {
    return this.doctor.addPrescription(user.id, recordId, dto);
  }

  @Patch('prescriptions/:id')
  updatePrescription(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePrescriptionDto,
  ) {
    return this.doctor.updatePrescription(user.id, id, dto);
  }

  @HttpCode(204)
  @Delete('prescriptions/:id')
  deletePrescription(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.doctor.deletePrescription(user.id, id);
  }

  @Patch('test-results/:id')
  updateTestResult(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTestResultDto,
  ) {
    return this.doctor.updateTestResult(user.id, id, dto);
  }

  @HttpCode(204)
  @Delete('test-results/:id')
  deleteTestResult(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.doctor.deleteTestResult(user.id, id);
  }

  @Post('records/:id/test-results')
  addTestResult(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) recordId: number,
    @Body() dto: CreateTestResultDto,
  ) {
    return this.doctor.addTestResult(user.id, recordId, dto);
  }

  @Get('schedule')
  schedule(@CurrentUser() user: AuthUser) {
    return this.doctor.schedule(user.id);
  }

  @Post('schedule')
  createSchedule(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.doctor.createSchedule(user.id, dto);
  }

  @HttpCode(204)
  @Delete('schedule/:id')
  deleteSchedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.doctor.deleteSchedule(user.id, id);
  }

  @Get('feedbacks')
  feedbacks(@CurrentUser() user: AuthUser) {
    return this.doctor.feedbacks(user.id);
  }
}
