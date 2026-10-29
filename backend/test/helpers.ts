import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type Mock, vi } from 'vitest';
import { AdminModule } from '../src/admin/admin.module.js';
import { AppController } from '../src/app.controller.js';
import { AppService } from '../src/app.service.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { DepartmentsModule } from '../src/departments/departments.module.js';
import { DiagnosesModule } from '../src/diagnoses/diagnoses.module.js';
import { DoctorModule } from '../src/doctor/doctor.module.js';
import { Role } from '../src/generated/prisma/client.js';
import { NotificationsModule } from '../src/notifications/notifications.module.js';
import { NurseModule } from '../src/nurse/nurse.module.js';
import { PatientModule } from '../src/patient/patient.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const MODELS = [
  'user',
  'department',
  'doctor',
  'schedule',
  'appointment',
  'diagnosis',
  'medicalRecord',
  'testResult',
  'prescription',
  'feedback',
  'notification',
];

export type PrismaMock = Record<string, Record<string, Mock>>;

/**
 * In-memory stand-in for PrismaService: every `prisma.<model>.<method>` is a
 * lazily created vi.fn(), so tests never touch a real database.
 */
export function createPrismaMock() {
  const fns = new Set<Mock>();

  const model = () => {
    const methods = new Map<string, Mock>();
    return new Proxy(
      {},
      {
        get: (_, name) => {
          if (typeof name !== 'string') return undefined;
          let fn = methods.get(name);
          if (!fn) {
            fn = vi.fn();
            fns.add(fn);
            methods.set(name, fn);
          }
          return fn;
        },
      },
    );
  };
  const models = new Map(MODELS.map((m) => [m, model()]));

  const db: PrismaMock = new Proxy({} as PrismaMock, {
    get: (_, key) => {
      if (typeof key !== 'string') return undefined;
      if (key === '$transaction') {
        return async (arg: unknown) =>
          typeof arg === 'function'
            ? arg(db)
            : Promise.all(arg as Promise<unknown>[]);
      }
      if (key === '$connect' || key === '$disconnect') return async () => {};
      return models.get(key);
    },
  });

  return { db, reset: () => fns.forEach((fn) => fn.mockReset()) };
}

export async function createTestApp() {
  const { db: prisma, reset } = createPrismaMock();

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
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  // Logger off: the access matrix deliberately provokes 500s from empty mocks.
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  // Same pipe as src/main.ts.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  const jwt = app.get(JwtService);

  /**
   * Returns an Authorization header for a user with `role`.
   * JwtAuthGuard loads the user with the first `user.findUnique`, so this
   * queues that answer. Call it BEFORE any other `user.findUnique` mock.
   */
  const as = (role: Role, id = 1, status = 'ACTIVE') => {
    const email = `${role.toLowerCase()}${id}@test.dev`;
    prisma.user.findUnique.mockResolvedValueOnce({ id, email, role, status });
    return `Bearer ${jwt.sign({ sub: id, email, role })}`;
  };

  return {
    app,
    prisma,
    reset,
    as,
    http: () => request(app.getHttpServer()),
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
