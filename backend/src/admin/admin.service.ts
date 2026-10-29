import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { paged, paginate } from '../common/page.dto.js';
import { DoctorService } from '../doctor/doctor.service.js';
import { CreateScheduleDto } from '../doctor/dto/doctor.dto.js';
import { Role, UserStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
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

const userSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  gender: true,
  dateOfBirth: true,
  address: true,
  role: true,
  status: true,
  createdAt: true,
} as const;

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly doctors: DoctorService,
  ) {}

  // --- users --------------------------------------------------------------

  async users(q: ListUsersQuery) {
    const where = {
      role: q.role,
      status: q.status,
      ...(q.search && {
        OR: [
          { firstName: { contains: q.search, mode: 'insensitive' as const } },
          { lastName: { contains: q.search, mode: 'insensitive' as const } },
          { email: { contains: q.search, mode: 'insensitive' as const } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { id: 'asc' },
        ...paginate(q),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async user(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { ...userSelect, doctor: { include: { department: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateUser(adminId: number, id: number, dto: UpdateUserDto) {
    await this.user(id);
    this.assertNotSelfLockout(adminId, id, dto);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: dto,
        select: userSelect,
      });
      // A user promoted to DOCTOR needs a doctors row (staff_id === user_id).
      if (dto.role === Role.DOCTOR) {
        await tx.doctor.upsert({
          where: { staffId: id },
          create: { staffId: id, hireDate: new Date() },
          update: {},
        });
      }
      return user;
    });
  }

  /** Users are never hard-deleted (medical history references them). */
  async deactivateUser(adminId: number, id: number) {
    await this.user(id);
    this.assertNotSelfLockout(adminId, id, { status: UserStatus.INACTIVE });
    return this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.INACTIVE },
      select: userSelect,
    });
  }

  async resetPassword(id: number, dto: ResetPasswordDto) {
    await this.user(id);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(dto.password, 10) },
    });
  }

  private assertNotSelfLockout(
    adminId: number,
    id: number,
    dto: { role?: Role; status?: UserStatus },
  ) {
    if (adminId !== id) return;
    if (
      (dto.role && dto.role !== Role.ADMIN) ||
      (dto.status && dto.status !== UserStatus.ACTIVE)
    ) {
      throw new BadRequestException(
        'You cannot remove your own admin access or deactivate yourself',
      );
    }
  }

  // --- doctors & schedules ------------------------------------------------

  listDoctors() {
    return this.prisma.doctor.findMany({
      include: { department: true, user: { select: personSelect } },
      orderBy: { staffId: 'asc' },
    });
  }

  async updateDoctor(id: number, dto: UpdateDoctorDto) {
    await this.getDoctor(id);
    if (dto.departmentId) {
      const department = await this.prisma.department.findUnique({
        where: { id: dto.departmentId },
      });
      if (!department) throw new NotFoundException('Department not found');
    }
    return this.prisma.doctor.update({ where: { staffId: id }, data: dto });
  }

  async doctorSchedule(id: number) {
    await this.getDoctor(id);
    return this.doctors.schedule(id);
  }

  async createDoctorSchedule(id: number, dto: CreateScheduleDto) {
    await this.getDoctor(id);
    return this.doctors.createSchedule(id, dto);
  }

  async deleteDoctorSchedule(id: number, scheduleId: number) {
    await this.getDoctor(id);
    return this.doctors.deleteSchedule(id, scheduleId);
  }

  private async getDoctor(staffId: number) {
    const doctor = await this.prisma.doctor.findUnique({ where: { staffId } });
    if (!doctor) throw new NotFoundException('Doctor not found');
    return doctor;
  }

  // --- appointments -------------------------------------------------------

  async appointments(q: ListAdminAppointmentsQuery) {
    const where = {
      status: q.status,
      doctorId: q.doctorId,
      patientId: q.patientId,
      appointmentDate: { gte: q.from, lte: q.to },
    };
    const [items, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        include: {
          patient: { select: personSelect },
          doctor: { include: { user: { select: personSelect } } },
        },
        orderBy: { appointmentDate: 'desc' },
        ...paginate(q),
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async appointment(id: number) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: { select: personSelect },
        doctor: { include: { user: { select: personSelect } } },
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  async updateAppointment(id: number, dto: AdminUpdateAppointmentDto) {
    await this.appointment(id);
    return this.prisma.appointment.update({ where: { id }, data: dto });
  }

  // --- feedbacks ----------------------------------------------------------

  async feedbacks(q: ListFeedbacksQuery) {
    const where = { doctorId: q.doctorId };
    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        include: {
          patient: { select: personSelect },
          doctor: { include: { user: { select: personSelect } } },
        },
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.feedback.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async deleteFeedback(id: number) {
    const { count } = await this.prisma.feedback.deleteMany({ where: { id } });
    if (!count) throw new NotFoundException('Feedback not found');
  }

  // --- notifications ------------------------------------------------------

  async sendNotification(dto: SendNotificationDto) {
    await this.user(dto.userId);
    return this.prisma.notification.create({ data: dto });
  }
}
