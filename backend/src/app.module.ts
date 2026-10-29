import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { AdminModule } from './admin/admin.module.js';
import { DepartmentsModule } from './departments/departments.module.js';
import { DiagnosesModule } from './diagnoses/diagnoses.module.js';
import { NurseModule } from './nurse/nurse.module.js';
import { DoctorModule } from './doctor/doctor.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PatientModule } from './patient/patient.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    DoctorModule,
    PatientModule,
    NotificationsModule,
    AdminModule,
    NurseModule,
    DepartmentsModule,
    DiagnosesModule,
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'backend',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
