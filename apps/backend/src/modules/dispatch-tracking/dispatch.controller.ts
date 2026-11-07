import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Public, RequestId, Roles } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import { MerchantsService } from '../merchant-catalogue/merchants.service';
import { DispatchService } from './dispatch.service';
import { DispatchViews } from './dispatch.views';
import {
  DeliveredDto,
  FailedDeliveryDto,
  OpsCancelFailedDto,
  DeliverMyselfDto,
  JobViewDto,
  LocationDto,
  MerchantDeliveryDto,
  MerchantDeliveryListDto,
  OpsDeliveryDto,
  OpsLiveDto,
  PickupDto,
  ReassignDto,
  RiderEarningsDto,
  RiderHomeDto,
  RiderStatusDto,
  RiderWeekDto,
  ResolveSosDto,
  SosDto,
  SosViewDto,
  StaffDeliveredDto,
  StatementPreviewDto,
  StatementQueryDto,
  TrackingDto,
} from './dto/dispatch.dto';

/** Rider app: status, location, offers and jobs. */
@ApiTags('riders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Roles('rider')
@Controller()
export class RiderController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly views: DispatchViews,
  ) {}

  @Get('riders/me')
  @ZodResponse({
    type: RiderHomeDto,
    description: 'Profile, today so far, the open offer (if any) and active jobs',
  })
  async me(@CurrentUser() u: AuthUser) {
    return this.views.riderHome(await this.dispatch.rider(u.userId));
  }

  @Put('riders/me/status')
  @ZodResponse({
    type: RiderHomeDto,
    description: 'Go online (with zones) or offline. Going offline declines an open offer.',
  })
  async status(@Body() b: RiderStatusDto, @CurrentUser() u: AuthUser) {
    return this.views.riderHome(await this.dispatch.setStatus(u.userId, b.online, b.zones));
  }

  @Post('riders/me/location')
  @HttpCode(204)
  async location(@Body() b: LocationDto, @CurrentUser() u: AuthUser) {
    await this.dispatch.riderLocation(u.userId, { lat: b.lat, lng: b.lng });
  }

  @Get('riders/me/earnings')
  @ZodResponse({ type: RiderEarningsDto, description: "Today's deliveries (IST) with the pay breakdown" })
  async earnings(@CurrentUser() u: AuthUser) {
    return this.views.earnings(await this.dispatch.rider(u.userId));
  }

  @Get('riders/me/earnings/week')
  @ZodResponse({ type: RiderWeekDto, description: 'The last 7 IST days, oldest first: deliveries, pay and COD cash per day' })
  async week(@CurrentUser() u: AuthUser) {
    const days = await this.dispatch.earningsWeek(u.userId);
    return { days, totalPaise: days.reduce((s, d) => s + d.earnedPaise, 0), deliveries: days.reduce((s, d) => s + d.deliveries, 0) };
  }

  @Post('riders/me/sos')
  @HttpCode(200)
  @ZodResponse({ type: SosViewDto, description: 'SOS (ADR-031): alerts Santha ops with the position and the delivery in hand; pressing again returns the open alert' })
  async sos(@Body() b: SosDto, @CurrentUser() u: AuthUser) {
    const s = await this.dispatch.sos(u.userId, b);
    return { id: s.id, createdAt: s.createdAt.toISOString(), fulfilmentId: s.fulfilmentId };
  }

  @Post('offers/:id/accept')
  @HttpCode(200)
  @ZodResponse({
    type: JobViewDto,
    description: '409 OFFER_EXPIRED after 30 s or when the order went elsewhere',
  })
  async accept(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.views.job(await this.dispatch.acceptOffer(u.userId, id), 'rider');
  }

  @Post('offers/:id/decline')
  @HttpCode(204)
  async decline(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    await this.dispatch.declineOffer(u.userId, id);
  }

  @Get('jobs/:id')
  @ZodResponse({ type: JobViewDto })
  async job(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.views.job(await this.dispatch.riderJob(u.userId, id), 'rider');
  }

  @Post('jobs/:id/arrived')
  @HttpCode(200)
  @ZodResponse({ type: JobViewDto, description: 'At the store (starts paid waiting after 5 min)' })
  async arrived(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.views.job(await this.dispatch.arrived(await this.dispatch.riderJob(u.userId, id)), 'rider');
  }

  @Post('jobs/:id/arrived-drop')
  @HttpCode(200)
  @ZodResponse({ type: JobViewDto, description: "At the customer's door: the customer is told; starts the waiting timer (ADR-030)" })
  async arrivedDrop(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.views.job(await this.dispatch.arrivedDrop(await this.dispatch.riderJob(u.userId, id)), 'rider');
  }

  @Post('jobs/:id/picked-up')
  @HttpCode(200)
  @ZodResponse({ type: JobViewDto, description: '422 WRONG_CODE; 409 NOT_READY while the store is packing' })
  async pickedUp(@Param('id', ParseUUIDPipe) id: string, @Body() b: PickupDto, @CurrentUser() u: AuthUser) {
    return this.views.job(
      await this.dispatch.pickedUp(
        await this.dispatch.riderJob(u.userId, id),
        'rider',
        u.userId,
        b.pickupCode,
      ),
      'rider',
    );
  }

  @Post('jobs/:id/delivered')
  @HttpCode(200)
  @ZodResponse({
    type: JobViewDto,
    description: "Customer's OTP or a door photo; cash collected for COD. 422 WRONG_CODE",
  })
  async delivered(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DeliveredDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.views.job(
      await this.dispatch.delivered(await this.dispatch.riderJob(u.userId, id), 'rider', u.userId, b),
      'rider',
    );
  }

  @Post('jobs/:id/failed')
  @HttpCode(200)
  @ZodResponse({ type: JobViewDto, description: "Couldn't deliver (ADR-026): the order waits as FAILED_DELIVERY. 409 INVALID_STATE unless on the way" })
  async failed(@Param('id', ParseUUIDPipe) id: string, @Body() b: FailedDeliveryDto, @CurrentUser() u: AuthUser) {
    return this.views.job(await this.dispatch.failed(await this.dispatch.riderJob(u.userId, id), 'rider', u.userId, b.reason, b.note), 'rider');
  }

  @Post('jobs/:id/retry')
  @HttpCode(200)
  @ZodResponse({ type: JobViewDto, description: 'Back on the way after a failed attempt (the customer called back)' })
  async retry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.views.job(await this.dispatch.retryDelivery(await this.dispatch.riderJob(u.userId, id), 'rider', u.userId), 'rider');
  }
}

/** Self-delivery staff link (/d/{token} on the web): no account, the token is the credential. */
@ApiTags('staff-jobs')
@Public()
@Controller('staff-jobs')
export class StaffJobsController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly views: DispatchViews,
  ) {}

  @Get(':token')
  @ZodResponse({ type: JobViewDto })
  async get(@Param('token') token: string) {
    return this.views.job(await this.dispatch.staffJob(token), 'staff');
  }

  @Post(':token/picked-up')
  @HttpCode(200)
  @ZodResponse({ type: JobViewDto, description: '409 NOT_READY until the store marks the order ready' })
  async pickedUp(@Param('token') token: string) {
    return this.views.job(
      await this.dispatch.pickedUp(await this.dispatch.staffJob(token), 'staff', null),
      'staff',
    );
  }

  @Post(':token/delivered')
  @HttpCode(200)
  @ZodResponse({ type: JobViewDto, description: "Customer's OTP; cash collected for COD. 422 WRONG_CODE" })
  async delivered(@Param('token') token: string, @Body() b: StaffDeliveredDto) {
    return this.views.job(
      await this.dispatch.delivered(await this.dispatch.staffJob(token), 'staff', null, b),
      'staff',
    );
  }

  @Post(':token/failed')
  @HttpCode(200)
  @ZodResponse({ type: JobViewDto, description: "Couldn't deliver (ADR-026)" })
  async failed(@Param('token') token: string, @Body() b: FailedDeliveryDto) {
    return this.views.job(await this.dispatch.failed(await this.dispatch.staffJob(token), 'staff', null, b.reason, b.note), 'staff');
  }

  @Post(':token/retry')
  @HttpCode(200)
  @ZodResponse({ type: JobViewDto, description: 'Back on the way after a failed attempt' })
  async retry(@Param('token') token: string) {
    return this.views.job(await this.dispatch.retryDelivery(await this.dispatch.staffJob(token), 'staff', null), 'staff');
  }

  @Post(':token/location')
  @HttpCode(204)
  async location(@Param('token') token: string, @Body() b: LocationDto) {
    await this.dispatch.staffLocation(await this.dispatch.staffJob(token), { lat: b.lat, lng: b.lng });
  }
}

/** Customer: live tracking and the no-courier cancel. */
@ApiTags('orders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('orders')
export class TrackingController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly views: DispatchViews,
  ) {}

  @Get(':id/tracking')
  @ZodResponse({
    type: TrackingDto,
    description: 'Courier, OTP, live location and ETA vs the promise. 404 until the store accepts.',
  })
  tracking(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.views.tracking(u.userId, id);
  }

  @Post(':id/cancel-no-courier')
  @HttpCode(204)
  async cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    await this.dispatch.cancelForNoCourier(u.userId, id);
  }
}

/** Merchant: deliveries for its orders, switching to self-delivery, statement preview. */
@ApiTags('merchants')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Roles('merchant')
@Controller('merchants/me')
export class MerchantDeliveriesController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly views: DispatchViews,
    private readonly merchants: MerchantsService,
  ) {}

  @Get('deliveries')
  @ZodResponse({
    type: MerchantDeliveryListDto,
    description: 'Active deliveries: pickup code, courier, staff link, fallback bonus',
  })
  async list(@CurrentUser() u: AuthUser) {
    const m = await this.merchants.ownedBy(u.userId);
    const active = (await this.dispatch.activeAll()).filter((f) => f.merchantId === m.id);
    return { items: await Promise.all(active.map((f) => this.views.merchantDelivery(f))) };
  }

  @Post('orders/:id/deliver-myself')
  @HttpCode(200)
  @ZodResponse({
    type: MerchantDeliveryDto,
    description: 'Switch a delivery still looking for a rider to self-delivery (any fallback bonus applies)',
  })
  async deliverMyself(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DeliverMyselfDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.views.merchantDelivery(
      await this.dispatch.switchToSelf(id, b.staffId ?? null, { ownerUserId: u.userId }),
    );
  }

  @Get('statements/preview')
  @ZodResponse({
    type: StatementPreviewDto,
    description:
      'Delivered orders of an IST day with the commission ladder and delivery-fee credit (final statements: M7)',
  })
  async statement(@Query() q: StatementQueryDto, @CurrentUser() u: AuthUser) {
    const m = await this.merchants.ownedBy(u.userId);
    return this.views.statement(m.id, m.microMarketId, q.date);
  }
}

/** Ops: live board and dispatch overrides (audited). */
@ApiTags('ops')
@ApiBearerAuth()
@Roles('admin', 'ops')
@Controller('ops')
export class OpsDispatchController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly views: DispatchViews,
  ) {}

  @Get('live')
  @ZodResponse({
    type: OpsLiveDto,
    description: 'KPIs, needs-attention, active orders with fulfilment, riders on the map',
  })
  live() {
    return this.views.live();
  }

  @Post('orders/:id/reassign')
  @HttpCode(200)
  @ZodResponse({ type: OpsDeliveryDto })
  async reassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ReassignDto,
    @CurrentUser() u: AuthUser,
    @RequestId() requestId: string | null,
  ) {
    await this.dispatch.reassign(id, b.riderUserId, { userId: u.userId, requestId });
    return this.views.opsDelivery(id);
  }

  @Post('orders/:id/force-self')
  @HttpCode(200)
  @ZodResponse({ type: OpsDeliveryDto })
  async forceSelf(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DeliverMyselfDto,
    @CurrentUser() u: AuthUser,
    @RequestId() requestId: string | null,
  ) {
    await this.dispatch.switchToSelf(id, b.staffId ?? null, { ops: { userId: u.userId, requestId } });
    return this.views.opsDelivery(id);
  }

  @Post('orders/:id/retry-delivery')
  @HttpCode(200)
  @ZodResponse({ type: OpsDeliveryDto, description: 'A failed delivery goes out again with the same courier (ADR-026); audited' })
  async retryDelivery(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    const f = await this.dispatch.fulfilmentForOrder(id);
    if (!f) throw new DomainError('NOT_FOUND', 'No delivery for this order');
    await this.dispatch.retryDelivery(f, 'ops', u.userId, { userId: u.userId, requestId });
    return this.views.opsDelivery(id);
  }

  @Post('orders/:id/cancel-failed-delivery')
  @HttpCode(200)
  @ZodResponse({ type: OpsDeliveryDto, description: 'Cancel a failed delivery, refunding the customer only when `refund` is true (ADR-026); audited' })
  async cancelFailed(@Param('id', ParseUUIDPipe) id: string, @Body() b: OpsCancelFailedDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    await this.dispatch.cancelFailed(id, b.refund, b.reason, { userId: u.userId, requestId });
    return this.views.opsDelivery(id);
  }

  @Post('sos/:id/resolve')
  @HttpCode(200)
  @ZodResponse({ type: SosViewDto, description: 'Close a rider SOS after ops reached the rider (ADR-031); audited' })
  async resolveSos(@Param('id', ParseUUIDPipe) id: string, @Body() b: ResolveSosDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    const s = await this.dispatch.resolveSos(id, { userId: u.userId, requestId }, b.note?.trim() || null);
    return { id: s.id, createdAt: s.createdAt.toISOString(), fulfilmentId: s.fulfilmentId };
  }
}
