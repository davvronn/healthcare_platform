import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller.js';

@Module({
  controllers: [DepartmentsController],
})
export class DepartmentsModule {}
