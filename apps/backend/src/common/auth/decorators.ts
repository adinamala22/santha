import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

export const IS_PUBLIC = 'santha:isPublic';
export const ROLES = 'santha:roles';

/** Marks a route as not requiring an access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route requires at least one of these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export interface AuthUser {
  userId: string;
  roles: Role[];
  deviceId: string;
  sessionId: string;
  app: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
  if (!req.user) throw new Error('CurrentUser used on a public route');
  return req.user;
});
