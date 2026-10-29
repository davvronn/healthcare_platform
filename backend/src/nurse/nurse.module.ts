import { Module } from '@nestjs/common';
import { NurseController } from './nurse.controller.js';

@Module({
  controllers: [NurseController],
})
export class NurseModule {}
