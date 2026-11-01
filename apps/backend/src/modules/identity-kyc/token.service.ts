import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AppId, Role } from '@prisma/client';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DomainError } from '../../common/errors/domain-error';

/** Claims carried in the access JWT. `did` binds the token to one app install. */
export interface AccessClaims {
  sub: string;
  roles: Role[];
  did: string;
  sid: string;
  app: AppId;
}

const ISSUER = 'santha';
const AUDIENCE = 'santha-api';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get accessTtlSec(): number {
    return this.env.JWT_ACCESS_TTL_SEC;
  }

  get refreshTtlSec(): number {
    return this.env.JWT_REFRESH_TTL_SEC;
  }

  /** Ops console sessions are short (8 h by default); app sessions last JWT_REFRESH_TTL_SEC. */
  refreshTtlFor(app: AppId): number {
    return app === 'web_admin' ? this.env.OPS_REFRESH_TTL_SEC : this.env.JWT_REFRESH_TTL_SEC;
  }

  /** Pepper for hashing refresh secrets and OTP codes at rest. */
  get pepper(): string {
    return this.env.JWT_REFRESH_SECRET;
  }

  signAccess(claims: AccessClaims): Promise<string> {
    return this.jwt.signAsync(
      { roles: claims.roles, did: claims.did, sid: claims.sid, app: claims.app },
      {
        secret: this.env.JWT_ACCESS_SECRET,
        subject: claims.sub,
        expiresIn: this.env.JWT_ACCESS_TTL_SEC,
        issuer: ISSUER,
        audience: AUDIENCE,
      },
    );
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const p = await this.jwt.verifyAsync<AccessClaims & { sub: string }>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      return { sub: p.sub, roles: p.roles ?? [], did: p.did, sid: p.sid, app: p.app };
    } catch {
      throw new DomainError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    }
  }
}
