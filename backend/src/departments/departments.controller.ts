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
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/roles.decorator.js';
import { Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

class CreateDepartmentDto {
  @IsString()
  @MaxLength(200)
  departmentName: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  location?: string;
}

class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  departmentName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  location?: string;
}

/** Reads: any authenticated user. Writes: ADMIN only. */
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.department.findMany({
      orderBy: { departmentName: 'asc' },
    });
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      include: { _count: { select: { doctors: true } } },
    });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateDepartmentDto) {
    return this.prisma.department.create({ data: dto });
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDepartmentDto,
  ) {
    await this.get(id);
    return this.prisma.department.update({ where: { id }, data: dto });
  }

  @Roles(Role.ADMIN)
  @HttpCode(204)
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.get(id);
    const doctors = await this.prisma.doctor.count({
      where: { departmentId: id },
    });
    if (doctors) {
      throw new ConflictException('Department still has doctors assigned');
    }
    await this.prisma.department.delete({ where: { id } });
  }
}
