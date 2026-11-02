import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Public, RequestId, Roles } from '../../common/auth/decorators';
import { CatalogueService } from './catalogue.service';
import {
  ApprovePendingDto,
  ApprovePendingResultDto,
  BarcodeRequestListDto,
  BarcodeResultDto,
  CategoryListDto,
  CategoryQueryDto,
  ConfirmResultDto,
  CreateItemDto,
  EnrichBarcodeDto,
  ImportDto,
  ImportReportDto,
  ItemDto,
  ItemPageDto,
  ItemQueryDto,
  MasterListDto,
  MasterQueryDto,
  MediaDto,
  MediaListDto,
  OpsItemQueryDto,
  PhotosDto,
  QaSummaryDto,
  ReviewItemDto,
  ReviewMediaDto,
  SlotListDto,
  SlotsDto,
  StockDto,
  SweepResultDto,
  toCategoryDto,
  toItemDto,
  toMasterDto,
  toOccurrenceDto,
  toSlotDto,
  UpdateItemDto,
  UploadRequestDto,
  UploadTicketDto,
} from './dto/catalogue.dto';
import { MerchantViewDto, toMediaDto, toViewDto } from './dto/merchants.dto';
import { MediaService } from './media.service';
import { MerchantsService } from './merchants.service';

const actor = (u: AuthUser, rid: string | null) => ({ userId: u.userId, requestId: rid });

@ApiTags('catalogue')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Roles('merchant')
@Controller('merchants/me')
export class MerchantCatalogueController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly merchants: MerchantsService,
    private readonly media: MediaService,
  ) {}

  @Get('categories')
  @ZodResponse({ type: CategoryListDto, description: 'Platform categories for this store type (FR-DIS-3)' })
  async categories(@CurrentUser() u: AuthUser) {
    const m = await this.merchants.ownedBy(u.userId);
    return { items: this.catalogue.categories(m.type).map(toCategoryDto) };
  }

  @Get('items')
  @ZodResponse({ type: ItemPageDto })
  async list(@Query() q: ItemQueryDto, @CurrentUser() u: AuthUser) {
    const m = await this.merchants.ownedBy(u.userId);
    const page = await this.catalogue.list(m, { status: q.status ? [q.status] : undefined, q: q.q, categorySlug: q.category, staleOnly: q.stale, limit: q.limit, offset: q.offset });
    return { items: page.items.map(toItemDto), total: page.total };
  }

  @Post('items')
  @ZodResponse({ status: 201, type: ItemDto, description: 'Created; status in_review if held by the prohibited-item check' })
  async create(@Body() b: CreateItemDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    const m = await this.merchants.ownedBy(u.userId);
    return toItemDto(await this.catalogue.create(m, actor(u, rid), b));
  }

  @Post('items/confirm')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: ConfirmResultDto, description: 'Daily check: every item is as listed (clears stale flags)' })
  async confirm(@CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    const m = await this.merchants.ownedBy(u.userId);
    return this.catalogue.confirmAll(m, actor(u, rid));
  }

  @Post('items/import')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: ImportReportDto, description: 'Bulk CSV upload with a validation report (FR-CAT-4)' })
  async import(@Body() b: ImportDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    const m = await this.merchants.ownedBy(u.userId);
    return this.catalogue.importCsv(m, actor(u, rid), b.csv, { dryRun: b.dryRun, source: 'import' });
  }

  @Post('items/approve')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: ApprovePendingResultDto, description: 'Approve items Santha built for you (FR-CAT-3)' })
  async approve(@Body() b: ApprovePendingDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    const m = await this.merchants.ownedBy(u.userId);
    return this.catalogue.approvePending(m, actor(u, rid), b.ids);
  }

  @Get('items/:id')
  @ZodResponse({ type: ItemDto })
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return toItemDto(await this.catalogue.get(await this.merchants.ownedBy(u.userId), id));
  }

  @Patch('items/:id')
  @ZodResponse({ type: ItemDto })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateItemDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    return toItemDto(await this.catalogue.update(await this.merchants.ownedBy(u.userId), actor(u, rid), id, b));
  }

  @Put('items/:id/stock')
  @ZodResponse({ type: ItemDto })
  async stock(@Param('id', ParseUUIDPipe) id: string, @Body() b: StockDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    return toItemDto(await this.catalogue.setStock(await this.merchants.ownedBy(u.userId), actor(u, rid), id, b.stock, b.variantId));
  }

  @Delete('items/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @RequestId() rid: string | null): Promise<void> {
    const m = await this.merchants.ownedBy(u.userId);
    const item = await this.catalogue.get(m, id);
    if (item.item.status === 'pending_merchant') await this.catalogue.rejectPending(m, actor(u, rid), id);
    else await this.catalogue.remove(m, actor(u, rid), id);
  }

  @Get('slots')
  @ZodResponse({ type: SlotListDto, description: 'Home-kitchen delivery slots and the next two days of occurrences' })
  async slots(@CurrentUser() u: AuthUser) {
    const m = await this.merchants.ownedBy(u.userId);
    const [slots, avail] = await Promise.all([this.catalogue.slots(m), this.catalogue.slotAvailability(m.id)]);
    return { slots: slots.map(toSlotDto), occurrences: avail.occurrences.map(toOccurrenceDto), nextOpen: avail.nextOpen ? toOccurrenceDto(avail.nextOpen) : null };
  }

  @Put('slots')
  @ZodResponse({ type: SlotListDto })
  async replaceSlots(@Body() b: SlotsDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    const m = await this.merchants.ownedBy(u.userId);
    const slots = await this.catalogue.replaceSlots(m, actor(u, rid), b.slots);
    const avail = await this.catalogue.slotAvailability(m.id);
    return { slots: slots.map(toSlotDto), occurrences: avail.occurrences.map(toOccurrenceDto), nextOpen: avail.nextOpen ? toOccurrenceDto(avail.nextOpen) : null };
  }

  @Put('photos')
  @ZodResponse({ type: MerchantViewDto, description: 'Store photos in display order' })
  async photos(@Body() b: PhotosDto, @CurrentUser() u: AuthUser) {
    return toViewDto(await this.merchants.setPhotos(u.userId, b.mediaIds));
  }

  @Post('media')
  @ZodResponse({ status: 201, type: UploadTicketDto, description: 'Presigned upload: PUT the image bytes to upload.url, then call complete' })
  async upload(@Body() b: UploadRequestDto, @CurrentUser() u: AuthUser) {
    const m = await this.merchants.ownedBy(u.userId);
    const t = await this.media.requestUpload(m.id, u.userId, b.purpose, b.contentType);
    return { media: toMediaDto(t.media), upload: { ...t.upload, expiresAt: t.upload.expiresAt.toISOString() } };
  }

  @Post('media/:id/complete')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: MediaDto, description: 'Makes WebP thumb + medium and queues the photo for moderation' })
  async complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    const m = await this.merchants.ownedBy(u.userId);
    return toMediaDto(await this.media.complete(m.id, id, actor(u, rid)));
  }
}

@ApiTags('catalogue')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('catalogue')
export class MasterCatalogueController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly merchants: MerchantsService,
  ) {}

  @Get('categories')
  @Public()
  @ZodResponse({ type: CategoryListDto, description: 'Platform taxonomy for a supply type (en + te)' })
  categories(@Query() q: CategoryQueryDto) {
    return { items: this.catalogue.categories(q.type).map(toCategoryDto) };
  }

  @Get('barcodes/:code')
  @Roles('merchant', 'admin', 'ops')
  @ZodResponse({ type: BarcodeResultDto, description: 'Scan → master product (open-barcode fallback). 404 BARCODE_UNKNOWN → create-SKU flow' })
  async barcode(@Param('code') code: string, @CurrentUser() u: AuthUser) {
    const merchant = u.roles.includes('merchant') ? await this.merchants.ownedBy(u.userId).catch(() => null) : null;
    const r = await this.catalogue.resolveBarcode(merchant, code);
    return { source: r.source, product: toMasterDto(r.product), existingItemId: r.existingItemId };
  }

  @Get('master')
  @Roles('merchant', 'admin', 'ops')
  @ZodResponse({ type: MasterListDto, description: 'Name search in the master catalogue' })
  async master(@Query() q: MasterQueryDto) {
    return { items: (await this.catalogue.searchMaster(q.q, q.limit)).map(toMasterDto) };
  }
}

@ApiTags('ops')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('ops/catalogue')
export class OpsCatalogueController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly merchants: MerchantsService,
    private readonly media: MediaService,
  ) {}

  @Get('summary')
  @Roles('admin', 'ops', 'support')
  @ZodResponse({ type: QaSummaryDto })
  summary() {
    return this.catalogue.qaSummary();
  }

  @Get('items')
  @Roles('admin', 'ops', 'support')
  @ZodResponse({ type: ItemPageDto, description: 'Catalogue QA: filter by status (in_review = held) or merchant' })
  async items(@Query() q: OpsItemQueryDto) {
    const page = await this.catalogue.listForOps({ merchantId: q.merchantId, status: q.status ? [q.status] : undefined, q: q.q, categorySlug: q.category, staleOnly: q.stale, limit: q.limit, offset: q.offset });
    return { items: page.items.map(toItemDto), total: page.total };
  }

  @Post('items/:id/review')
  @HttpCode(200)
  @Roles('admin', 'ops')
  @ZodResponse({ status: 200, type: ItemDto })
  async reviewItem(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReviewItemDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    return toItemDto(await this.catalogue.review(id, b.decision, actor(u, rid), b.note));
  }

  @Get('media')
  @Roles('admin', 'ops', 'support')
  @ZodResponse({ type: MediaListDto, description: 'Photos waiting for moderation, oldest first' })
  async mediaQueue() {
    return { items: (await this.media.queue()).map((m) => ({ ...toMediaDto(this.media.view(m)), merchantId: m.merchantId })) };
  }

  @Post('media/:id/review')
  @HttpCode(200)
  @Roles('admin', 'ops')
  @ZodResponse({ status: 200, type: MediaDto })
  async reviewMedia(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReviewMediaDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    return toMediaDto(await this.media.review(id, b.decision, actor(u, rid), b.reason));
  }

  @Get('barcode-requests')
  @Roles('admin', 'ops', 'support')
  @ZodResponse({ type: BarcodeRequestListDto, description: 'Enrichment queue: scanned barcodes nobody knew' })
  async requests() {
    return { items: (await this.catalogue.barcodeRequests('open')).map((r) => ({ barcode: r.barcode, scanCount: r.scanCount, lastMerchantId: r.lastMerchantId, status: r.status, createdAt: r.createdAt.toISOString() })) };
  }

  @Post('master')
  @Roles('admin', 'ops')
  @ZodResponse({ status: 201, type: BarcodeResultDto, description: 'Add a product to the master catalogue (resolves its enrichment request)' })
  async enrich(@Body() b: EnrichBarcodeDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    const p = await this.catalogue.enrichBarcode(b, actor(u, rid));
    return { source: 'master' as const, product: toMasterDto(p), existingItemId: null };
  }

  @Post('merchants/:merchantId/items')
  @Roles('admin', 'ops')
  @ZodResponse({ status: 201, type: ItemDto, description: "Assisted entry: builds an item for the merchant's approval (FR-CAT-3)" })
  async assistedCreate(@Param('merchantId', ParseUUIDPipe) merchantId: string, @Body() b: CreateItemDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    const m = await this.merchants.record(merchantId);
    return toItemDto(await this.catalogue.create(m, actor(u, rid), b, 'ops'));
  }

  @Patch('merchants/:merchantId/items/:id')
  @Roles('admin', 'ops')
  @ZodResponse({ type: ItemDto })
  async assistedUpdate(
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: UpdateItemDto,
    @CurrentUser() u: AuthUser,
    @RequestId() rid: string | null,
  ) {
    const m = await this.merchants.record(merchantId);
    return toItemDto(await this.catalogue.update(m, actor(u, rid), id, b, { ops: true }));
  }

  @Post('merchants/:merchantId/items/import')
  @HttpCode(200)
  @Roles('admin', 'ops')
  @ZodResponse({ status: 200, type: ImportReportDto, description: "Assisted bulk entry from a merchant's list; items await their approval" })
  async assistedImport(@Param('merchantId', ParseUUIDPipe) merchantId: string, @Body() b: ImportDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    const m = await this.merchants.record(merchantId);
    return this.catalogue.importCsv(m, actor(u, rid), b.csv, { dryRun: b.dryRun, source: 'ops' });
  }

  @Post('staleness-sweep')
  @HttpCode(200)
  @Roles('admin')
  @ZodResponse({ status: 200, type: SweepResultDto, description: 'Run the staleness sweep now (it also runs on a schedule)' })
  sweep(@CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    return this.catalogue.sweepStaleness(actor(u, rid));
  }
}
