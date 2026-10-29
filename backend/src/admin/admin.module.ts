import { Module } from '@nestjs/common';
import { DoctorModule } from '../doctor/doctor.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [DoctorModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
