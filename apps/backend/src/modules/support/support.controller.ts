import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { type AuthUser, CurrentUser, RequestId, Roles } from '../../common/auth/decorators';
import { createZodDto } from '../../common/zod-dto';
import type { SupportApp, SupportMessageRecord, SupportThreadRecord, ThreadStatus } from './support.repository';
import { ALL_TOPICS, SupportService } from './support.service';

const iso = z.iso.datetime();
const body = z.string().trim().min(1).max(1000);

const ThreadSchema = z.object({
  id: z.uuid(),
  app: z.enum(['consumer', 'merchant', 'rider']),
  orderId: z.uuid().nullable(),
  orderCode: z.string().nullable(),
  topic: z.string(),
  status: z.enum(['waiting_support', 'waiting_customer', 'resolved']),
  lastMessageAt: iso,
  lastMessagePreview: z.string(),
  unreadByUser: z.number().int(),
  resolvedAt: iso.nullable(),
  createdAt: iso,
});
const MessageSchema = z.object({ id: z.uuid(), author: z.enum(['user', 'support']), body: z.string(), createdAt: iso });

class OpenThreadDto extends createZodDto(
  z.object({
    topic: z.enum(ALL_TOPICS as unknown as [string, ...string[]]).describe('From the app’s topic list'),
    orderId: z.uuid().optional().describe('The order this is about (yours, your store’s, or one you deliver)'),
    body,
  }),
) {}
class WriteDto extends createZodDto(z.object({ body })) {}
class ThreadListDto extends createZodDto(z.object({ items: z.array(ThreadSchema) })) {}
class ThreadWithMessagesDto extends createZodDto(ThreadSchema.extend({ messages: z.array(MessageSchema) })) {}

const OpsThreadSchema = ThreadSchema.extend({ assigneeId: z.uuid().nullable(), userId: z.uuid() });
class OpsThreadListDto extends createZodDto(z.object({ items: z.array(OpsThreadSchema) })) {}
class OpsThreadDto extends createZodDto(
  OpsThreadSchema.extend({ messages: z.array(MessageSchema), requester: z.object({ phoneMasked: z.string(), name: z.string().nullable() }) }),
) {}
class InboxQueryDto extends createZodDto(
  z.object({
    status: z.string().optional().describe('Comma-separated: waiting_support, waiting_customer, resolved'),
    mine: z.enum(['true', 'false']).optional(),
    orderId: z.uuid().optional(),
  }),
) {}

const toThread = (t: SupportThreadRecord) => ({
  id: t.id,
  app: t.app,
  orderId: t.orderId,
  orderCode: t.orderCode,
  topic: t.topic,
  status: t.status,
  lastMessageAt: t.lastMessageAt.toISOString(),
  lastMessagePreview: t.lastMessagePreview,
  unreadByUser: t.unreadByUser,
  resolvedAt: t.resolvedAt?.toISOString() ?? null,
  createdAt: t.createdAt.toISOString(),
});
const toOpsThread = (t: SupportThreadRecord) => ({ ...toThread(t), assigneeId: t.assigneeId, userId: t.userId });
const toMessage = (m: SupportMessageRecord) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt.toISOString() });
const appOf = (u: AuthUser): SupportApp => (['consumer', 'merchant', 'rider'] as const).find((a) => a === u.app) ?? 'consumer';

/** The apps: chat with Santha support (ADR-028). */
@ApiTags('support')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('support/threads')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @ZodResponse({ status: 201, type: ThreadWithMessagesDto, description: 'Starts a chat, or adds to the open one about the same order. 429 RATE_LIMITED with 3 open chats' })
  async open(@Body() b: OpenThreadDto, @CurrentUser() u: AuthUser) {
    const t = await this.support.open(u.userId, appOf(u), b);
    const r = await this.support.read(u.userId, t.id);
    return { ...toThread(r.thread), messages: r.messages.map(toMessage) };
  }

  @Get()
  @ZodResponse({ type: ThreadListDto, description: 'My chats, latest first' })
  async mine(@CurrentUser() u: AuthUser) {
    return { items: (await this.support.mine(u.userId)).map(toThread) };
  }

  @Get(':id')
  @ZodResponse({ type: ThreadWithMessagesDto, description: 'One chat with its messages; support replies count as read' })
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    const r = await this.support.read(u.userId, id);
    return { ...toThread(r.thread), messages: r.messages.map(toMessage) };
  }

  @Post(':id/messages')
  @ZodResponse({ status: 201, type: ThreadWithMessagesDto, description: 'Writes to the chat (reopens a recently resolved one). 429 RATE_LIMITED' })
  async write(@Param('id', ParseUUIDPipe) id: string, @Body() b: WriteDto, @CurrentUser() u: AuthUser) {
    await this.support.write(u.userId, id, b.body);
    const r = await this.support.read(u.userId, id);
    return { ...toThread(r.thread), messages: r.messages.map(toMessage) };
  }
}

/** Ops console: the support inbox (ADR-028). Replies, assignment and resolving are audited. */
@ApiTags('ops')
@ApiBearerAuth()
@Roles('admin', 'ops', 'support')
@Controller('ops/support/threads')
export class OpsSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @ZodResponse({ type: OpsThreadListDto, description: 'Inbox, latest activity first' })
  async inbox(@Query() q: InboxQueryDto, @CurrentUser() u: AuthUser) {
    const statuses = q.status ? (q.status.split(',').map((s) => s.trim()) as ThreadStatus[]) : undefined;
    return { items: (await this.support.inbox({ statuses, orderId: q.orderId, assigneeId: q.mine === 'true' ? u.userId : undefined })).map(toOpsThread) };
  }

  @Get(':id')
  @ZodResponse({ type: OpsThreadDto })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const r = await this.support.opsThread(id);
    return { ...toOpsThread(r.thread), messages: r.messages.map(toMessage), requester: r.requester };
  }

  @Post(':id/messages')
  @HttpCode(200)
  @ZodResponse({ type: OpsThreadDto, description: 'Reply: the requester gets a push (SMS without the app); audited' })
  async reply(@Param('id', ParseUUIDPipe) id: string, @Body() b: WriteDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    await this.support.reply(id, b.body, { userId: u.userId, requestId });
    return this.get(id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @ZodResponse({ type: OpsThreadDto, description: 'Assign to me; audited' })
  async assign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    await this.support.assign(id, { userId: u.userId, requestId });
    return this.get(id);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ZodResponse({ type: OpsThreadDto, description: 'Resolved; the requester can reopen it by writing within 7 days; audited' })
  async resolve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    await this.support.resolve(id, { userId: u.userId, requestId });
    return this.get(id);
  }
}
