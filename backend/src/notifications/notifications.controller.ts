import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { type AuthUser, CurrentUser } from '../auth/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

class ListNotificationsQuery {
  /** ?unread=true returns only unread notifications */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unread?: boolean;
}

/** Available to any authenticated user (patient, doctor, nurse, admin). */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListNotificationsQuery) {
    return this.prisma.notification.findMany({
      where: { userId: user.id, ...(q.unread && { isRead: false }) },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { isRead: true },
    });
    if (!count) throw new NotFoundException('Notification not found');
    return { id, isRead: true };
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() user: AuthUser) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    return { updated: count };
  }
}
