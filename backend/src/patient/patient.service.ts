import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, UserStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BookAppointmentDto,
  CreateFeedbackDto,
  ListDoctorsQuery,
  ListMyAppointmentsQuery,
  UpdateProfileDto,
} from './dto/patient.dto.js';

const doctorPublicSelect = {
  staffId: true,
  specialization: true,
  department: { select: { id: true, departmentName: true, location: true } },
  user: { select: { firstName: true, lastName: true } },
} as const;

const recordInclude = {
  diagnosis: true,
  prescriptions: true,
  testResults: true,
  appointment: {
    select: {
      id: true,
      appointmentDate: true,
      doctor: {
        select: {
          staffId: true,
          specialization: true,
          user: { select: { firstName: true, lastName: true } },
        },
      },
    },
  },
} as const;

/**
 * Every method takes the patient's user id and scopes its queries by it,
 * so a patient can only reach their own data.
 */
@Injectable()
export class PatientService {
  constructor(private readonly prisma: PrismaService) {}

  // --- profile ------------------------------------------------------------

  profile(patientId: number) {
    return this.prisma.user.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        gender: true,
        dateOfBirth: true,
        address: true,
        createdAt: true,
      },
    });
  }

  updateProfile(patientId: number, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: patientId },
      data: dto,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        gender: true,
        dateOfBirth: true,
        address: true,
      },
    });
  }

  // --- doctors catalogue --------------------------------------------------

  departments() {
    return this.prisma.department.findMany({ orderBy: { departmentName: 'asc' } });
  }

  async doctors(q: ListDoctorsQuery) {
    const doctors = await this.prisma.doctor.findMany({
      where: {
        departmentId: q.departmentId,
        specialization: q.specialization
          ? { contains: q.specialization, mode: 'insensitive' }
          : undefined,
        user: { status: UserStatus.ACTIVE },
      },
      select: doctorPublicSelect,
    });
    const ratings = await this.prisma.feedback.groupBy({
      by: ['doctorId'],
      where: { doctorId: { in: doctors.map((d) => d.staffId) } },
      _avg: { rating: true },
      _count: true,
    });
    const byDoctor = new Map(ratings.map((r) => [r.doctorId, r]));
    return doctors.map((d) => ({
      ...d,
      averageRating: byDoctor.get(d.staffId)?._avg.rating ?? null,
      feedbackCount: byDoctor.get(d.staffId)?._count ?? 0,
    }));
  }

  async doctorSchedule(doctorId: number) {
    await this.getActiveDoctor(doctorId);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return this.prisma.schedule.findMany({
      where: { doctorId, workDate: { gte: today } },
      orderBy: [{ workDate: 'asc' }, { startTime: 'asc' }],
    });
  }

  // --- appointments -------------------------------------------------------

  async book(patientId: number, dto: BookAppointmentDto) {
    const doctor = await this.getActiveDoctor(dto.doctorId);
    if (dto.doctorId === patientId) {
      throw new BadRequestException('You cannot book an appointment with yourself');
    }
    if (dto.appointmentDate.getTime() <= Date.now()) {
      throw new BadRequestException('appointmentDate must be in the future');
    }
    await this.assertWithinSchedule(dto.doctorId, dto.appointmentDate);

    const taken = await this.prisma.appointment.findFirst({
      where: {
        doctorId: dto.doctorId,
        appointmentDate: dto.appointmentDate,
        status: { not: AppointmentStatus.CANCELLED },
      },
      select: { id: true },
    });
    if (taken) throw new ConflictException('This time slot is already taken');

    const appointment = await this.prisma.appointment.create({
      data: {
        patientId,
        doctorId: doctor.staffId,
        appointmentDate: dto.appointmentDate,
        reason: dto.reason,
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: doctor.staffId,
        appointmentId: appointment.id,
        title: 'New appointment request',
        message: `Appointment on ${dto.appointmentDate.toISOString()}`,
      },
    });
    return appointment;
  }

  appointments(patientId: number, q: ListMyAppointmentsQuery) {
    return this.prisma.appointment.findMany({
      where: { patientId, status: q.status },
      include: { doctor: { select: doctorPublicSelect } },
      orderBy: { appointmentDate: 'desc' },
    });
  }

  async appointment(patientId: number, id: number) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, patientId },
      include: { doctor: { select: doctorPublicSelect } },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  async cancel(patientId: number, id: number) {
    const appointment = await this.appointment(patientId, id);
    const cancellable: AppointmentStatus[] = ['PENDING', 'CONFIRMED'];
    if (!cancellable.includes(appointment.status)) {
      throw new BadRequestException(
        `Cannot cancel an appointment with status ${appointment.status}`,
      );
    }
    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CANCELLED },
    });
    await this.prisma.notification.create({
      data: {
        userId: appointment.doctorId,
        appointmentId: id,
        title: 'Appointment cancelled by patient',
        message: `Appointment on ${appointment.appointmentDate.toISOString()}`,
      },
    });
    return updated;
  }

  // --- medical data -------------------------------------------------------

  records(patientId: number) {
    return this.prisma.medicalRecord.findMany({
      where: { patientId },
      include: recordInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async record(patientId: number, id: number) {
    const record = await this.prisma.medicalRecord.findFirst({
      where: { id, patientId },
      include: recordInclude,
    });
    if (!record) throw new NotFoundException('Medical record not found');
    return record;
  }

  prescriptions(patientId: number) {
    return this.prisma.prescription.findMany({
      where: { record: { patientId } },
      orderBy: { id: 'desc' },
    });
  }

  testResults(patientId: number) {
    return this.prisma.testResult.findMany({
      where: { record: { patientId } },
      orderBy: { testDate: 'desc' },
    });
  }

  // --- feedbacks ----------------------------------------------------------

  async createFeedback(patientId: number, dto: CreateFeedbackDto) {
    await this.getActiveDoctor(dto.doctorId);
    const visited = await this.prisma.appointment.findFirst({
      where: {
        patientId,
        doctorId: dto.doctorId,
        status: AppointmentStatus.COMPLETED,
      },
      select: { id: true },
    });
    if (!visited) {
      throw new BadRequestException(
        'You can only review a doctor after a completed appointment',
      );
    }
    const existing = await this.prisma.feedback.findFirst({
      where: { patientId, doctorId: dto.doctorId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('You have already reviewed this doctor');
    }
    return this.prisma.feedback.create({ data: { ...dto, patientId } });
  }

  feedbacks(patientId: number) {
    return this.prisma.feedback.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- helpers ------------------------------------------------------------

  private async getActiveDoctor(staffId: number) {
    const doctor = await this.prisma.doctor.findFirst({
      where: { staffId, user: { status: UserStatus.ACTIVE } },
      select: { staffId: true },
    });
    if (!doctor) throw new NotFoundException('Doctor not found');
    return doctor;
  }

  /** The requested time must fall inside one of the doctor's schedule slots (UTC). */
  private async assertWithinSchedule(doctorId: number, when: Date) {
    const day = new Date(when);
    day.setUTCHours(0, 0, 0, 0);
    const slots = await this.prisma.schedule.findMany({
      where: { doctorId, workDate: day },
    });
    const time = when.toISOString().slice(11, 16);
    const fits = slots.some(
      (s) =>
        s.startTime.toISOString().slice(11, 16) <= time &&
        time < s.endTime.toISOString().slice(11, 16),
    );
    if (!fits) {
      throw new BadRequestException(
        "The doctor does not work at this time (see /patient/doctors/:id/schedule)",
      );
    }
  }
}
