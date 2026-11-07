import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser, CurrentUser, RequestId, Roles } from '../../common/auth/decorators';
import { maskPhone } from '../../common/pii';
import { AuthService } from '../identity-kyc/auth.service';
import {
  AadhaarStartDto,
  AadhaarVerifyDto,
  BankDto,
  KycCheckDto,
  PanDto,
  toKycDto,
} from '../merchant-catalogue/dto/merchants.dto';
import { RIDER_STATUSES, type RiderPhotoRecord, type RiderRecord, type RiderStatus } from './dispatch.repository';
import { RiderPhotosService } from './rider-photos.service';
import {
  DrivingLicenceDto,
  OpsRiderDto,
  OpsRiderListDto,
  OpsRiderQueryDto,
  RiderApproveDto,
  RiderOnboardingDto,
  RiderProfileDto,
  RiderPhotoDto,
  RiderPhotoRequestDto,
  RiderPhotoTicketDto,
  RiderReasonDto,
} from './dto/rider-onboarding.dto';
import { type RiderOnboardingView, RiderOnboardingService, type RiderVehicle } from './rider-onboarding.service';

const iso = (d: Date | null) => d?.toISOString() ?? null;

const toOnboarding = (v: RiderOnboardingView) => ({
  status: v.rider.status,
  statusNote: v.rider.statusNote,
  name: v.rider.name,
  vehicle: v.rider.vehicle as RiderVehicle,
  vehicleNumber: v.rider.vehicleNumber,
  editable: v.editable,
  steps: v.steps,
  checks: v.checks.map(toKycDto),
  photos: { selfie: !!v.photos.selfie, licence: !!v.photos.licence },
  submittedAt: iso(v.rider.submittedAt),
});
const toPhoto = (p: RiderPhotoRecord) => ({ id: p.id, kind: p.kind, status: p.status });

/** Rider app: sign-up details and documents (ADR-029). */
@ApiTags('riders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Roles('rider')
@Controller('riders/me')
export class RiderOnboardingController {
  constructor(
    private readonly onboarding: RiderOnboardingService,
    private readonly photos: RiderPhotosService,
  ) {}

  @Post('photos')
  @ZodResponse({ status: 201, type: RiderPhotoTicketDto, description: 'Presigned upload (PUT the bytes to upload.url, then complete). Selfie / licence card while signing up; a door photo for a delivery on the way (ADR-030)' })
  async photo(@Body() b: RiderPhotoRequestDto, @CurrentUser() u: AuthUser) {
    const t = await this.photos.request(u.userId, b);
    return { photo: toPhoto(t.photo), upload: { ...t.upload, expiresAt: t.upload.expiresAt.toISOString() } };
  }

  @Post('photos/:id/complete')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: RiderPhotoDto, description: 'Checks and stores the photo privately' })
  async photoDone(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return toPhoto(await this.photos.complete(u.userId, id));
  }

  @Get('onboarding')
  @ZodResponse({ type: RiderOnboardingDto, description: 'Sign-up status, steps and document checks' })
  async get(@CurrentUser() u: AuthUser) {
    return toOnboarding(await this.onboarding.view(u.userId));
  }

  @Put('profile')
  @ZodResponse({ type: RiderOnboardingDto, description: 'Name, vehicle and number plate (none for a cycle)' })
  async profile(@Body() b: RiderProfileDto, @CurrentUser() u: AuthUser) {
    return toOnboarding(await this.onboarding.updateProfile(u.userId, b));
  }

  @Put('kyc/pan')
  @ZodResponse({ type: KycCheckDto })
  async pan(@Body() b: PanDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.onboarding.runKyc(u.userId, (k, s, a) => k.verifyPan(s, b, a)));
  }

  @Post('kyc/aadhaar/start')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: KycCheckDto, description: 'OTP sent to the Aadhaar-linked mobile; status pending' })
  async aadhaarStart(@Body() b: AadhaarStartDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.onboarding.runKyc(u.userId, (k, s, a) => k.startAadhaar(s, b, a)));
  }

  @Post('kyc/aadhaar/verify')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: KycCheckDto })
  async aadhaarVerify(@Body() b: AadhaarVerifyDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.onboarding.runKyc(u.userId, (k, s, a) => k.completeAadhaar(s, b, a)));
  }

  @Put('kyc/driving-licence')
  @ZodResponse({ type: KycCheckDto, description: 'Recorded for ops to check against the card (status pending)' })
  async drivingLicence(@Body() b: DrivingLicenceDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.onboarding.runKyc(u.userId, (k, s, a) => k.recordDrivingLicence(s, b, a)));
  }

  @Put('kyc/bank')
  @ZodResponse({ type: KycCheckDto, description: 'Penny-drop check of the payout account' })
  async bank(@Body() b: BankDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.onboarding.runKyc(u.userId, (k, s, a) => k.verifyBank(s, b, a)));
  }

  @Post('submit')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: RiderOnboardingDto, description: '422 CHECKLIST_INCOMPLETE with the missing steps' })
  async submit(@CurrentUser() u: AuthUser) {
    return toOnboarding(await this.onboarding.submit(u.userId));
  }
}

/** Ops console: the rider queue, review, approve / reject / pause (every decision audited). */
@ApiTags('ops')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('ops/riders')
export class OpsRidersController {
  constructor(
    private readonly onboarding: RiderOnboardingService,
    private readonly auth: AuthService,
    private readonly photos: RiderPhotosService,
  ) {}

  private async row(r: RiderRecord) {
    const user = await this.auth.me(r.userId);
    return {
      userId: r.userId,
      name: r.name,
      phoneMasked: maskPhone(user.phone),
      vehicle: r.vehicle as RiderVehicle,
      vehicleNumber: r.vehicleNumber,
      status: r.status,
      online: r.online,
      rating: r.rating,
      submittedAt: iso(r.submittedAt),
      decidedAt: iso(r.decidedAt),
    };
  }

  private async full(v: RiderOnboardingView) {
    return {
      ...toOnboarding(v),
      ...(await this.row(v.rider)),
      selfieUrl: await this.photos.url(v.photos.selfie),
      licenceUrl: await this.photos.url(v.photos.licence),
    };
  }

  @Get()
  @Roles('admin', 'ops', 'support')
  @ZodResponse({ type: OpsRiderListDto })
  async list(@Query() q: OpsRiderQueryDto) {
    const status = q.status
      ?.split(',')
      .map((s) => s.trim())
      .filter((s): s is RiderStatus => (RIDER_STATUSES as readonly string[]).includes(s));
    return { items: await Promise.all((await this.onboarding.list(status?.length ? status : undefined)).map((r) => this.row(r))) };
  }

  @Get(':id')
  @Roles('admin', 'ops', 'support')
  @ZodResponse({ type: OpsRiderDto })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.full(await this.onboarding.detail(id));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('admin', 'ops')
  @ZodResponse({ status: 200, type: OpsRiderDto, description: 'From submitted (all checks done) or to lift a pause; audited' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() b: RiderApproveDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    return this.full(await this.onboarding.approve(id, { userId: u.userId, requestId: rid }, b.note));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('admin', 'ops')
  @ZodResponse({ status: 200, type: OpsRiderDto, description: 'Back to the rider to fix; the reason is shown to them; audited' })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: RiderReasonDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    return this.full(await this.onboarding.reject(id, { userId: u.userId, requestId: rid }, b.reason));
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @Roles('admin', 'ops')
  @ZodResponse({ status: 200, type: OpsRiderDto, description: 'No new offers at once; a delivery in hand is finished; audited' })
  async suspend(@Param('id', ParseUUIDPipe) id: string, @Body() b: RiderReasonDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    return this.full(await this.onboarding.suspend(id, { userId: u.userId, requestId: rid }, b.reason));
  }
}
