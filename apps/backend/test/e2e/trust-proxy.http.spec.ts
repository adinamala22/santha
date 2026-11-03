/**
 * Behind Caddy, the per-IP OTP and ops-login limits must see the real client address, not the proxy's.
 * TRUST_PROXY=1 trusts exactly one hop: the address the proxy appended wins, and anything a client puts
 * in X-Forwarded-For itself is ignored.
 */
import { Controller, Get, INestApplication, Module, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { configureApp } from '../../src/app.factory';

@Controller('whoami')
class WhoAmI {
  @Get()
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

@Module({ controllers: [WhoAmI] })
class TinyModule {}

async function boot(trustProxy: string | undefined): Promise<INestApplication> {
  if (trustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = trustProxy;
  const app = await NestFactory.create(TinyModule, { logger: false });
  configureApp(app);
  await app.init();
  return app;
}

describe('client IP behind a reverse proxy', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY;
  });

  it('TRUST_PROXY=1: the address added by the proxy is the client; a spoofed one in front is ignored', async () => {
    app = await boot('1');
    // Caddy appends the connecting address; a client may have sent its own X-Forwarded-For before it.
    const res = await request(app.getHttpServer()).get('/v1/whoami').set('X-Forwarded-For', '1.2.3.4, 203.0.113.7').expect(200);
    expect(res.body.ip).toBe('203.0.113.7');
  });

  it('default (no proxy): X-Forwarded-For is not trusted at all', async () => {
    app = await boot(undefined);
    const res = await request(app.getHttpServer()).get('/v1/whoami').set('X-Forwarded-For', '203.0.113.7').expect(200);
    expect(res.body.ip).not.toBe('203.0.113.7');
  });
});
