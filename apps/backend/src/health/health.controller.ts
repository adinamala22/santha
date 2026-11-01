import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../common/auth/decorators';
import { PrismaService } from '../infra/prisma/prisma.service';
import { REDIS } from '../infra/redis/redis.module';

const LivenessSchema = z.object({ status: z.literal('ok') });
class LivenessDto extends createZodDto(LivenessSchema) {}

const CheckSchema = z.object({ ok: z.boolean(), latencyMs: z.number(), detail: z.string().optional() });
const ReadinessSchema = z
  .object({ status: z.enum(['ok', 'degraded']), checks: z.object({ postgres: CheckSchema, redis: CheckSchema }) });
class ReadinessDto extends createZodDto(ReadinessSchema) {}

async function timed(fn: () => Promise<string | undefined>, timeoutMs = 2000) {
  const t0 = Date.now();
  try {
    const detail = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    return { ok: true, latencyMs: Date.now() - t0, ...(detail ? { detail } : {}) };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message.slice(0, 200) : 'error' };
  }
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get()
  @ZodResponse({ type: LivenessDto })
  live() {
    return { status: 'ok' as const };
  }

  /** Readiness: Postgres (with PostGIS) and Redis reachable. 503 when degraded. */
  @Get('ready')
  @ZodResponse({ type: ReadinessDto })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [postgres, redis] = await Promise.all([
      timed(async () => {
        const rows = await this.prisma.$queryRaw<Array<{ v: string }>>`SELECT postgis_lib_version() AS v`;
        return `postgis ${rows[0]?.v ?? '?'}`;
      }),
      timed(async () => {
        if (this.redis.status === 'wait') await this.redis.connect();
        await this.redis.ping();
        return undefined;
      }),
    ]);
    const status = postgres.ok && redis.ok ? ('ok' as const) : ('degraded' as const);
    if (status !== 'ok') res.status(503);
    return { status, checks: { postgres, redis } };
  }
}
