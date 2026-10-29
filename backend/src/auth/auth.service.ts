import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { Role, UserStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateStaffDto } from './dto/create-staff.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

const userSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  gender: true,
  dateOfBirth: true,
  address: true,
  role: true,
  status: true,
  createdAt: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Public registration always creates a PATIENT. */
  async register(dto: RegisterDto) {
    const user = await this.createUser(dto, Role.PATIENT);
    return {
      user,
      accessToken: await this.sign(user.id, user.email, user.role),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    const valid =
      user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }
    return {
      accessToken: await this.sign(user.id, user.email, user.role),
    };
  }

  me(id: number) {
    return this.prisma.user.findUnique({ where: { id }, select: userSelect });
  }

  /** Creates staff (doctor, nurse, admin); ADMIN only. */
  createStaff(dto: CreateStaffDto) {
    return this.createUser(dto, dto.role, {
      specialization: dto.specialization,
      licenseNumber: dto.licenseNumber,
    });
  }

  private async createUser(
    dto: RegisterDto,
    role: Role,
    doctor?: { specialization?: string; licenseNumber?: string },
  ) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Email already registered');
    }
    return this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email,
        phone: dto.phone,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth,
        address: dto.address,
        passwordHash: await bcrypt.hash(dto.password, 10),
        role,
        ...(role === Role.DOCTOR && {
          doctor: { create: { ...doctor, hireDate: new Date() } },
        }),
      },
      select: userSelect,
    });
  }

  private sign(sub: number, email: string, role: Role) {
    return this.jwt.signAsync({ sub, email, role });
  }
}
