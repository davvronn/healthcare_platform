import {
  Body,
  Controller,
  Get,
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
  BookAppointmentDto,
  CreateFeedbackDto,
  ListDoctorsQuery,
  ListMyAppointmentsQuery,
  UpdateProfileDto,
} from './dto/patient.dto.js';
import { PatientService } from './patient.service.js';

/** Patient-only API: every route here requires the PATIENT role. */
@Roles(Role.PATIENT)
@Controller('patient')
export class PatientController {
  constructor(private readonly patient: PatientService) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.patient.profile(user.id);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.patient.updateProfile(user.id, dto);
  }

  @Get('departments')
  departments() {
    return this.patient.departments();
  }

  @Get('doctors')
  doctors(@Query() query: ListDoctorsQuery) {
    return this.patient.doctors(query);
  }

  @Get('doctors/:id/schedule')
  doctorSchedule(@Param('id', ParseIntPipe) id: number) {
    return this.patient.doctorSchedule(id);
  }

  @Post('appointments')
  book(@CurrentUser() user: AuthUser, @Body() dto: BookAppointmentDto) {
    return this.patient.book(user.id, dto);
  }

  @Get('appointments')
  appointments(
    @CurrentUser() user: AuthUser,
    @Query() query: ListMyAppointmentsQuery,
  ) {
    return this.patient.appointments(user.id, query);
  }

  @Get('appointments/:id')
  appointment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.patient.appointment(user.id, id);
  }

  @Patch('appointments/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.patient.cancel(user.id, id);
  }

  @Get('records')
  records(@CurrentUser() user: AuthUser) {
    return this.patient.records(user.id);
  }

  @Get('records/:id')
  record(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.patient.record(user.id, id);
  }

  @Get('prescriptions')
  prescriptions(@CurrentUser() user: AuthUser) {
    return this.patient.prescriptions(user.id);
  }

  @Get('test-results')
  testResults(@CurrentUser() user: AuthUser) {
    return this.patient.testResults(user.id);
  }

  @Post('feedbacks')
  createFeedback(@CurrentUser() user: AuthUser, @Body() dto: CreateFeedbackDto) {
    return this.patient.createFeedback(user.id, dto);
  }

  @Get('feedbacks')
  feedbacks(@CurrentUser() user: AuthUser) {
    return this.patient.feedbacks(user.id);
  }
}
