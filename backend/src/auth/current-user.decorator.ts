import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '../generated/prisma/client.js';

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
