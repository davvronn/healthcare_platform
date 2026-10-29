import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
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

const patientSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  gender: true,
  dateOfBirth: true,
} as const;

const toTime = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

// Allowed status changes; the doctor cannot reopen a finished appointment.
const transitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Every method takes the doctor's user id (doctors.staff_id === users.user_id)
 * and scopes its queries by it, so a doctor can only reach their own data.
 */
@Injectable()
export class DoctorService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(doctorId: number) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { staffId: doctorId },
      include: {
        department: true,
        user: { select: { ...patientSelect, address: true } },
      },
    });
    if (!doctor) throw new NotFoundException('Doctor profile not found');
    return doctor;
  }

  // --- appointments -------------------------------------------------------

  appointments(doctorId: number, q: ListAppointmentsQuery) {
    return this.prisma.appointment.findMany({
      where: {
        doctorId,
        status: q.status,
        appointmentDate: { gte: q.from, lte: q.to },
      },
      include: { patient: { select: patientSelect } },
      orderBy: { appointmentDate: 'asc' },
    });
  }

  async appointment(doctorId: number, id: number) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, doctorId },
      include: { patient: { select: patientSelect }, medicalRecord: true },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  async updateAppointmentStatus(
    doctorId: number,
    id: number,
    dto: UpdateAppointmentStatusDto,
  ) {
    const current = await this.appointment(doctorId, id);
    if (!transitions[current.status].includes(dto.status)) {
      throw new BadRequestException(
        `Cannot change status from ${current.status} to ${dto.status}`,
      );
    }
    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: dto.status, notes: dto.notes ?? current.notes },
    });
    await this.prisma.notification.create({
      data: {
        userId: current.patientId,
        appointmentId: id,
        title: `Appointment ${dto.status.toLowerCase()}`,
        message: `Appointment on ${current.appointmentDate.toISOString()}`,
      },
    });
    return updated;
  }

  // --- patients -----------------------------------------------------------

  patients(doctorId: number) {
    return this.prisma.user.findMany({
      where: { appointments: { some: { doctorId } } },
      select: patientSelect,
      orderBy: { lastName: 'asc' },
    });
  }

  /** Full history of a patient the doctor has had an appointment with. */
  async patientRecords(doctorId: number, patientId: number) {
    const treated = await this.prisma.appointment.findFirst({
      where: { doctorId, patientId },
      select: { id: true },
    });
    if (!treated) throw new ForbiddenException('Not your patient');
    return this.prisma.medicalRecord.findMany({
      where: { patientId },
      include: { diagnosis: true, prescriptions: true, testResults: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- medical records ----------------------------------------------------

  async createRecord(doctorId: number, dto: CreateRecordDto) {
    const appointment = await this.appointment(doctorId, dto.appointmentId);
    if (appointment.medicalRecord) {
      throw new ConflictException('Record for this appointment already exists');
    }
    if (dto.diagnosisId) {
      const diagnosis = await this.prisma.diagnosis.findUnique({
        where: { id: dto.diagnosisId },
      });
      if (!diagnosis) throw new NotFoundException('Diagnosis not found');
    }
    return this.prisma.medicalRecord.create({
      data: {
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        diagnosisId: dto.diagnosisId,
        treatment: dto.treatment,
        prescription: dto.prescription,
        prescriptions: { create: dto.prescriptions ?? [] },
      },
      include: { diagnosis: true, prescriptions: true },
    });
  }

  records(doctorId: number) {
    return this.prisma.medicalRecord.findMany({
      where: { appointment: { doctorId } },
      include: {
        diagnosis: true,
        prescriptions: true,
        testResults: true,
        patient: { select: patientSelect },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async record(doctorId: number, id: number) {
    const record = await this.prisma.medicalRecord.findFirst({
      where: { id, appointment: { doctorId } },
      include: {
        diagnosis: true,
        prescriptions: true,
        testResults: true,
        patient: { select: patientSelect },
      },
    });
    if (!record) throw new NotFoundException('Medical record not found');
    return record;
  }

  async updateRecord(doctorId: number, id: number, dto: UpdateRecordDto) {
    await this.record(doctorId, id);
    if (dto.diagnosisId) {
      const diagnosis = await this.prisma.diagnosis.findUnique({
        where: { id: dto.diagnosisId },
      });
      if (!diagnosis) throw new NotFoundException('Diagnosis not found');
    }
    return this.prisma.medicalRecord.update({ where: { id }, data: dto });
  }

  async addPrescription(
    doctorId: number,
    recordId: number,
    dto: PrescriptionItemDto,
  ) {
    await this.record(doctorId, recordId);
    return this.prisma.prescription.create({ data: { ...dto, recordId } });
  }

  async updatePrescription(
    doctorId: number,
    id: number,
    dto: UpdatePrescriptionDto,
  ) {
    await this.ownPrescription(doctorId, id);
    return this.prisma.prescription.update({ where: { id }, data: dto });
  }

  async deletePrescription(doctorId: number, id: number) {
    await this.ownPrescription(doctorId, id);
    await this.prisma.prescription.delete({ where: { id } });
  }

  async updateTestResult(
    doctorId: number,
    id: number,
    dto: UpdateTestResultDto,
  ) {
    await this.ownTestResult(doctorId, id);
    return this.prisma.testResult.update({ where: { id }, data: dto });
  }

  async deleteTestResult(doctorId: number, id: number) {
    await this.ownTestResult(doctorId, id);
    await this.prisma.testResult.delete({ where: { id } });
  }

  private async ownPrescription(doctorId: number, id: number) {
    const found = await this.prisma.prescription.findFirst({
      where: { id, record: { appointment: { doctorId } } },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Prescription not found');
  }

  private async ownTestResult(doctorId: number, id: number) {
    const found = await this.prisma.testResult.findFirst({
      where: { id, record: { appointment: { doctorId } } },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Test result not found');
  }

  async addTestResult(
    doctorId: number,
    recordId: number,
    dto: CreateTestResultDto,
  ) {
    const record = await this.prisma.medicalRecord.findFirst({
      where: { id: recordId, appointment: { doctorId } },
      select: { id: true },
    });
    if (!record) throw new NotFoundException('Medical record not found');
    return this.prisma.testResult.create({
      data: { ...dto, recordId },
    });
  }

  // --- schedule -----------------------------------------------------------

  schedule(doctorId: number) {
    return this.prisma.schedule.findMany({
      where: { doctorId },
      orderBy: [{ workDate: 'asc' }, { startTime: 'asc' }],
    });
  }

  createSchedule(doctorId: number, dto: CreateScheduleDto) {
    if (dto.startTime >= dto.endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }
    return this.prisma.schedule.create({
      data: {
        doctorId,
        workDate: dto.workDate,
        startTime: toTime(dto.startTime),
        endTime: toTime(dto.endTime),
      },
    });
  }

  async deleteSchedule(doctorId: number, id: number) {
    const { count } = await this.prisma.schedule.deleteMany({
      where: { id, doctorId },
    });
    if (!count) throw new NotFoundException('Schedule entry not found');
  }

  // --- feedbacks ----------------------------------------------------------

  async feedbacks(doctorId: number) {
    const [items, stats] = await Promise.all([
      this.prisma.feedback.findMany({
        where: { doctorId },
        include: { patient: { select: { id: true, firstName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.feedback.aggregate({
        where: { doctorId },
        _avg: { rating: true },
        _count: true,
      }),
    ]);
    return {
      averageRating: stats._avg.rating,
      total: stats._count,
      items,
    };
  }
}
