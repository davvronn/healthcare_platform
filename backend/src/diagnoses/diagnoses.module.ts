import { Module } from '@nestjs/common';
import { DiagnosesController } from './diagnoses.controller.js';

@Module({
  controllers: [DiagnosesController],
})
export class DiagnosesModule {}
