import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { AdminModule } from '../../src/admin/admin.module.js';
import { AppController } from '../../src/app.controller.js';
import { AppService } from '../../src/app.service.js';
import { AuthModule } from '../../src/auth/auth.module.js';
import { DepartmentsModule } from '../../src/departments/departments.module.js';
import { DiagnosesModule } from '../../src/diagnoses/diagnoses.module.js';
import { DoctorModule } from '../../src/doctor/doctor.module.js';
import {
  AppointmentStatus,
  Role,
} from '../../src/generated/prisma/client.js';
import { NotificationsModule } from '../../src/notifications/notifications.module.js';
import { NurseModule } from '../../src/nurse/nurse.module.js';
import { PatientModule } from '../../src/patient/patient.module.js';
import { PrismaModule } from '../../src/prisma/prisma.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export const PASSWORD = 'Passw0rd!';
const hash = bcrypt.hashSync(PASSWORD, 4);

const TABLES = [
  'notifications',
  'feedbacks',
  'prescriptions',
  'test_results',
  'medical_records',
  'appointments',
  'schedules',
  'doctors',
  'departments',
  'diagnosis',
  'users',
];

/** The real application (real PrismaService, real Postgres), as in main.ts. */
export async function createDbApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [
      PrismaModule,
      AuthModule,
      AdminModule,
      DoctorModule,
      PatientModule,
      NurseModule,
      NotificationsModule,
      DepartmentsModule,
      DiagnosesModule,
    ],
    controllers: [AppController],
    providers: [AppService],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  const prisma = app.get(PrismaService);
  const http = () => request(app.getHttpServer());

  /** Empties every table and restarts the id sequences. */
  const reset = () =>
    prisma.$executeRawUnsafe(
      `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );

  /** Logs in through the real /auth/login and returns an Authorization header. */
  const login = async (email: string) => {
    const res = await http()
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return `Bearer ${res.body.accessToken}` as string;
  };

  let n = 0;
  const seed = {
    user: (role: Role, over: Record<string, unknown> = {}) => {
      n++;
      return prisma.user.create({
        data: {
          firstName: role.toLowerCase(),
          lastName: `n${n}`,
          email: `${role.toLowerCase()}${n}@test.dev`,
          passwordHash: hash,
          role,
          ...over,
        },
      });
    },
    patient: (over: Record<string, unknown> = {}) => seed.user('PATIENT', over),
    nurse: (over: Record<string, unknown> = {}) => seed.user('NURSE', over),
    admin: (over: Record<string, unknown> = {}) => seed.user('ADMIN', over),
    async doctor(over: { user?: Record<string, unknown>; [k: string]: unknown } = {}) {
      const { user: userOver, ...doctorOver } = over;
      const user = await seed.user('DOCTOR', userOver);
      const doctor = await prisma.doctor.create({
        data: { staffId: user.id, specialization: 'Cardiology', ...doctorOver },
      });
      return { ...user, doctor };
    },
    department: (departmentName = 'Cardiology') =>
      prisma.department.create({ data: { departmentName } }),
    diagnosis: (name = 'Flu') => prisma.diagnosis.create({ data: { name } }),
    appointment: (
      patientId: number,
      doctorId: number,
      over: { appointmentDate?: Date; status?: AppointmentStatus } = {},
    ) =>
      prisma.appointment.create({
        data: {
          patientId,
          doctorId,
          appointmentDate: new Date('2030-01-02T10:00:00Z'),
          ...over,
        },
      }),
  };

  return { app, prisma, http, reset, login, seed };
}

export type DbApp = Awaited<ReturnType<typeof createDbApp>>;
