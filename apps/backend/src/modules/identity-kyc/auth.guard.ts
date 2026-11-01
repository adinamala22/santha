import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import type { Request } from 'express';
import { AuthUser, IS_PUBLIC, ROLES } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import { TokenService } from './token.service';

export const DEVICE_HEADER = 'x-device-id';

/**
 * Global guard: every route needs a valid access token unless marked @Public().
 * Device binding: the `X-Device-Id` header must match the token's `did` claim.
 * Role check: @Roles(...) requires any one of the listed roles.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true; // WebSocket auth is handled by the gateway (M5)
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new DomainError('UNAUTHENTICATED', 'Please sign in to continue.');

    const claims = await this.tokens.verifyAccess(token);
    if (req.headers[DEVICE_HEADER] !== claims.did)
      throw new DomainError('DEVICE_MISMATCH', 'This session belongs to another device. Please sign in again.');

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (required?.length && !required.some((r) => claims.roles.includes(r)))
      throw new DomainError('FORBIDDEN', 'You do not have access to this.');

    req.user = { userId: claims.sub, roles: claims.roles, deviceId: claims.did, sessionId: claims.sid, app: claims.app };
    return true;
  }
}
