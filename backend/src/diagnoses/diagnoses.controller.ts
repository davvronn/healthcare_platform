import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/roles.decorator.js';
import { PageQuery, paged, paginate } from '../common/page.dto.js';
import { Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

class ListDiagnosesQuery extends PageQuery {
  @IsOptional()
  @IsString()
  search?: string;
}

class CreateDiagnosisDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class UpdateDiagnosisDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

/** Diagnosis catalogue. Staff read it; doctors may add entries, ADMIN edits. */
@Roles(Role.DOCTOR, Role.NURSE, Role.ADMIN)
@Controller('diagnoses')
export class DiagnosesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() q: ListDiagnosesQuery) {
    const where = q.search
      ? { name: { contains: q.search, mode: 'insensitive' as const } }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.diagnosis.findMany({
        where,
        orderBy: { name: 'asc' },
        ...paginate(q),
      }),
      this.prisma.diagnosis.count({ where }),
    ]);
    return paged(items, total, q);
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const diagnosis = await this.prisma.diagnosis.findUnique({ where: { id } });
    if (!diagnosis) throw new NotFoundException('Diagnosis not found');
    return diagnosis;
  }

  @Roles(Role.DOCTOR, Role.ADMIN)
  @Post()
  create(@Body() dto: CreateDiagnosisDto) {
    return this.prisma.diagnosis.create({ data: dto });
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDiagnosisDto,
  ) {
    await this.get(id);
    return this.prisma.diagnosis.update({ where: { id }, data: dto });
  }

  @Roles(Role.ADMIN)
  @HttpCode(204)
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.get(id);
    const used = await this.prisma.medicalRecord.count({
      where: { diagnosisId: id },
    });
    if (used) {
      throw new ConflictException('Diagnosis is used in medical records');
    }
    await this.prisma.diagnosis.delete({ where: { id } });
  }
}
