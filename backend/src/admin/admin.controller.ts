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
import { CreateScheduleDto } from '../doctor/dto/doctor.dto.js';
import { Role } from '../generated/prisma/client.js';
import { AdminService } from './admin.service.js';
import {
  AdminUpdateAppointmentDto,
  ListAdminAppointmentsQuery,
  ListFeedbacksQuery,
  ListUsersQuery,
  ResetPasswordDto,
  SendNotificationDto,
  UpdateDoctorDto,
  UpdateUserDto,
} from './dto/admin.dto.js';

/** Admin-only API: every route here requires the ADMIN role. */
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // users
  @Get('users')
  users(@Query() q: ListUsersQuery) {
    return this.admin.users(q);
  }

  @Get('users/:id')
  user(@Param('id', ParseIntPipe) id: number) {
    return this.admin.user(id);
  }

  @Patch('users/:id')
  updateUser(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    return this.admin.updateUser(me.id, id, dto);
  }

  @Delete('users/:id')
  deactivateUser(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.admin.deactivateUser(me.id, id);
  }

  @HttpCode(204)
  @Post('users/:id/password')
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.admin.resetPassword(id, dto);
  }

  // doctors & schedules
  @Get('doctors')
  doctors() {
    return this.admin.listDoctors();
  }

  @Patch('doctors/:id')
  updateDoctor(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDoctorDto,
  ) {
    return this.admin.updateDoctor(id, dto);
  }

  @Get('doctors/:id/schedule')
  doctorSchedule(@Param('id', ParseIntPipe) id: number) {
    return this.admin.doctorSchedule(id);
  }

  @Post('doctors/:id/schedule')
  createDoctorSchedule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.admin.createDoctorSchedule(id, dto);
  }

  @HttpCode(204)
  @Delete('doctors/:id/schedule/:scheduleId')
  deleteDoctorSchedule(
    @Param('id', ParseIntPipe) id: number,
    @Param('scheduleId', ParseIntPipe) scheduleId: number,
  ) {
    return this.admin.deleteDoctorSchedule(id, scheduleId);
  }

  // appointments
  @Get('appointments')
  appointments(@Query() q: ListAdminAppointmentsQuery) {
    return this.admin.appointments(q);
  }

  @Get('appointments/:id')
  appointment(@Param('id', ParseIntPipe) id: number) {
    return this.admin.appointment(id);
  }

  @Patch('appointments/:id')
  updateAppointment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminUpdateAppointmentDto,
  ) {
    return this.admin.updateAppointment(id, dto);
  }

  // feedbacks
  @Get('feedbacks')
  feedbacks(@Query() q: ListFeedbacksQuery) {
    return this.admin.feedbacks(q);
  }

  @HttpCode(204)
  @Delete('feedbacks/:id')
  deleteFeedback(@Param('id', ParseIntPipe) id: number) {
    return this.admin.deleteFeedback(id);
  }

  // notifications
  @Post('notifications')
  sendNotification(@Body() dto: SendNotificationDto) {
    return this.admin.sendNotification(dto);
  }
}
