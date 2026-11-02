import { Controller, Get, Global, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { createZodDto } from '../../common/zod-dto';
import { z } from 'zod';
import { Roles } from '../../common/auth/decorators';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { FakeSinks } from '../fake/fake-sinks';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditRow {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  actorId: string | null;
  microMarketId: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  createdAt: Date;
}

export interface AuditQuery {
  entity?: string | undefined;
  entityId?: string | undefined;
  limit: number;
}

/** Read side of the audit log (writes happen inside each module's transaction). */
export abstract class AuditReader {
  abstract list(q: AuditQuery): Promise<AuditRow[]>;
}

@Injectable()
class PrismaAuditReader extends AuditReader {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  list(q: AuditQuery): Promise<AuditRow[]> {
    return this.prisma.auditEvent.findMany({
      where: { entity: q.entity, entityId: q.entityId },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
  }
}

class MemoryAuditReader extends AuditReader {
  constructor(private readonly sinks: FakeSinks) {
    super();
  }

  async list(q: AuditQuery): Promise<AuditRow[]> {
    return this.sinks.audits
      .filter((a) => (!q.entity || a.entity === q.entity) && (!q.entityId || a.entityId === q.entityId))
      .slice(-q.limit)
      .reverse()
      .map((a) => ({
        ...a,
        microMarketId: a.microMarketId ?? null,
        before: a.before ?? null,
        after: a.after ?? null,
        requestId: a.requestId ?? null,
      }));
  }
}

const AuditQuerySchema = z.object({
  entity: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
class AuditQueryDto extends createZodDto(AuditQuerySchema) {}

const AuditRowSchema = z.object({
  id: z.string(),
  entity: z.string(),
  entityId: z.string(),
  action: z.string(),
  actorId: z.string().nullable(),
  microMarketId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  requestId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
class AuditListDto extends createZodDto(z.object({ items: z.array(AuditRowSchema) })) {}

@ApiTags('ops')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('ops/audit')
class AuditController {
  constructor(private readonly reader: AuditReader) {}

  @Get()
  @Roles('admin', 'ops', 'finance', 'support')
  @ZodResponse({ type: AuditListDto })
  async list(@Query() q: AuditQueryDto) {
    return { items: (await this.reader.list(q)).map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })) };
  }
}

/** Fake-mode sinks (events + audit rows) and the audit read API. */
@Global()
@Module({
  controllers: [AuditController],
  providers: [
    FakeSinks,
    {
      provide: AuditReader,
      inject: [ENV, PrismaService, FakeSinks],
      useFactory: (env: Env, prisma: PrismaService, sinks: FakeSinks) =>
        env.DATA_STORE === 'memory' ? new MemoryAuditReader(sinks) : new PrismaAuditReader(prisma),
    },
  ],
  exports: [FakeSinks, AuditReader],
})
export class AuditModule {}
