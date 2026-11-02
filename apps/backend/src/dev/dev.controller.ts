import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DEV_CLOCK, type DevClock } from '../common/clock';
import { Public } from '../common/auth/decorators';
import { DomainError } from '../common/errors/domain-error';
import { ObjectStorage, MemoryObjectStorage } from '../infra/storage/object-storage';

class AdvanceClockDto extends createZodDto(z.object({ hours: z.number().min(0).max(24 * 30).default(0), minutes: z.number().min(0).max(60 * 24).default(0) })) {}

/**
 * Fake-mode helpers (DATA_STORE=memory only; 404 otherwise): in-memory image upload/serving that
 * stands in for S3, and the forward-only dev clock. Not part of the public API.
 */
@ApiExcludeController()
@Public()
@Controller('dev')
export class DevController {
  constructor(
    private readonly storage: ObjectStorage,
    @Inject(DEV_CLOCK) private readonly clock: DevClock | null,
  ) {}

  private memory(): MemoryObjectStorage {
    if (!(this.storage instanceof MemoryObjectStorage)) throw new DomainError('NOT_FOUND', 'Not found');
    return this.storage;
  }

  /** Target of MemoryObjectStorage presigned URLs. Body is the raw image (express raw parser). */
  @Put('uploads')
  @HttpCode(200)
  async upload(@Query() q: Record<string, string>, @Req() req: Request): Promise<{ ok: true }> {
    const store = this.memory();
    const key = q.key ?? '';
    const ct = q.ct ?? '';
    if (!store.verify(key, ct, Number(q.exp), q.sig ?? '')) throw new DomainError('FORBIDDEN', 'Upload link expired or invalid');
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new DomainError('VALIDATION_FAILED', `Send the image bytes with Content-Type ${ct}`);
    await store.put(key, body, ct);
    return { ok: true };
  }

  @Get('media/*key')
  serve(@Param('key') key: string | string[], @Res() res: Response): void {
    const entry = this.memory().entry(Array.isArray(key) ? key.join('/') : key);
    if (!entry) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', entry.contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(entry.body);
  }

  @Get('clock')
  now() {
    if (!this.clock) throw new DomainError('NOT_FOUND', 'Not found');
    return { now: this.clock.now().toISOString(), offsetMs: this.clock.offset };
  }

  @Post('clock')
  @HttpCode(200)
  advance(@Body() b: AdvanceClockDto) {
    if (!this.clock) throw new DomainError('NOT_FOUND', 'Not found');
    const now = this.clock.advance((b.hours * 60 + b.minutes) * 60_000);
    return { now: now.toISOString(), offsetMs: this.clock.offset };
  }
}
