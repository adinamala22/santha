import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser, CurrentUser, RequestId, Roles } from '../../common/auth/decorators';
import {
  AadhaarStartDto,
  AadhaarVerifyDto,
  AddStaffDto,
  ApproveDto,
  AvailabilityDto,
  BankDto,
  CreateMerchantDto,
  GstExemptionDto,
  GstinDto,
  KycCheckDto,
  LicenceNumberDto,
  MerchantListDto,
  MerchantViewDto,
  OpsQueueQueryDto,
  OpsRadiusDto,
  PanDto,
  RejectDto,
  StaffDto,
  toKycDto,
  toViewDto,
  UpdateMerchantDto,
} from './dto/merchants.dto';
import { MerchantsService } from './merchants.service';
import { maskPhone } from '../../common/pii';

@ApiTags('merchants')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Roles('merchant')
@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Post()
  @ZodResponse({ status: 201, type: MerchantViewDto, description: 'Store created as a draft' })
  async create(@Body() body: CreateMerchantDto, @CurrentUser() u: AuthUser) {
    return toViewDto(await this.merchants.create(u.userId, body));
  }

  @Get('me')
  @ZodResponse({ type: MerchantViewDto })
  async mine(@CurrentUser() u: AuthUser) {
    return toViewDto(await this.merchants.mine(u.userId));
  }

  @Patch('me')
  @ZodResponse({ type: MerchantViewDto })
  async update(@Body() body: UpdateMerchantDto, @CurrentUser() u: AuthUser) {
    return toViewDto(await this.merchants.update(u.userId, body));
  }

  @Put('me/availability')
  @ZodResponse({ type: MerchantViewDto, description: 'Open or pause the store (M5). Re-opening clears the missed-order count after an auto-pause.' })
  async availability(@Body() body: AvailabilityDto, @CurrentUser() u: AuthUser) {
    return toViewDto(await this.merchants.setAvailability(u.userId, body.open));
  }

  @Put('me/kyc/pan')
  @ZodResponse({ type: KycCheckDto })
  async pan(@Body() b: PanDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.merchants.runKyc(u.userId, (k, s, a) => k.verifyPan(s, b, a)));
  }

  @Post('me/kyc/aadhaar/start')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: KycCheckDto, description: 'OTP sent to the Aadhaar-linked mobile; status pending' })
  async aadhaarStart(@Body() b: AadhaarStartDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.merchants.runKyc(u.userId, (k, s, a) => k.startAadhaar(s, b, a)));
  }

  @Post('me/kyc/aadhaar/verify')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: KycCheckDto })
  async aadhaarVerify(@Body() b: AadhaarVerifyDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.merchants.runKyc(u.userId, (k, s, a) => k.completeAadhaar(s, b, a)));
  }

  @Put('me/kyc/gstin')
  @ZodResponse({ type: KycCheckDto })
  async gstin(@Body() b: GstinDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.merchants.runKyc(u.userId, (k, s, a) => k.verifyGstin(s, b, a)));
  }

  @Put('me/kyc/gst-exemption')
  @ZodResponse({ type: KycCheckDto })
  async gstExemption(@Body() b: GstExemptionDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.merchants.runKyc(u.userId, (k, s, a) => k.declareGstExemption(s, b, a)));
  }

  @Put('me/kyc/fssai')
  @ZodResponse({ type: KycCheckDto })
  async fssai(@Body() b: LicenceNumberDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.merchants.runKyc(u.userId, (k, s, a) => k.verifyFssai(s, b, a)));
  }

  @Put('me/kyc/drug-licence')
  @ZodResponse({ type: KycCheckDto })
  async drugLicence(@Body() b: LicenceNumberDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.merchants.runKyc(u.userId, (k, s, a) => k.recordDrugLicence(s, b, a)));
  }

  @Put('me/kyc/bank')
  @ZodResponse({ type: KycCheckDto })
  async bank(@Body() b: BankDto, @CurrentUser() u: AuthUser) {
    return toKycDto(await this.merchants.runKyc(u.userId, (k, s, a) => k.verifyBank(s, b, a)));
  }

  @Post('me/staff')
  @ZodResponse({ status: 201, type: StaffDto })
  async addStaff(@Body() b: AddStaffDto, @CurrentUser() u: AuthUser) {
    const s = await this.merchants.addStaff(u.userId, b);
    return { id: s.id, name: s.name, phoneMasked: maskPhone(s.phone), active: s.active };
  }

  @Delete('me/staff/:id')
  @HttpCode(204)
  async removeStaff(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser): Promise<void> {
    await this.merchants.removeStaff(u.userId, id);
  }

  @Post('me/submit')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: MerchantViewDto, description: 'Submitted for review' })
  async submit(@CurrentUser() u: AuthUser) {
    return toViewDto(await this.merchants.submit(u.userId));
  }
}

@ApiTags('ops')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('ops/merchants')
export class OpsMerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  @Roles('admin', 'ops', 'support')
  @ZodResponse({ type: MerchantListDto })
  async queue(@Query() q: OpsQueueQueryDto) {
    return { items: (await this.merchants.queue(q)).map(toViewDto) };
  }

  @Get(':id')
  @Roles('admin', 'ops', 'support')
  @ZodResponse({ type: MerchantViewDto })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return toViewDto(await this.merchants.detail(id));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('admin', 'ops')
  @ZodResponse({ status: 200, type: MerchantViewDto })
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() b: ApproveDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    return toViewDto(await this.merchants.approve(id, { userId: u.userId, requestId: rid }, b.note));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('admin', 'ops')
  @ZodResponse({ status: 200, type: MerchantViewDto })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: RejectDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    return toViewDto(await this.merchants.reject(id, { userId: u.userId, requestId: rid }, b));
  }

  @Put(':id/radius')
  @Roles('admin', 'ops')
  @ZodResponse({ status: 200, type: MerchantViewDto, description: 'How far the store delivers (audited)' })
  async radius(@Param('id', ParseUUIDPipe) id: string, @Body() b: OpsRadiusDto, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    return toViewDto(await this.merchants.setRadius(id, b.radiusM, b.reason, { userId: u.userId, requestId: rid }));
  }

  @Post(':id/go-live')
  @HttpCode(200)
  @Roles('admin', 'ops')
  @ZodResponse({ status: 200, type: MerchantViewDto })
  async goLive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @RequestId() rid: string | null) {
    return toViewDto(await this.merchants.goLive(id, { userId: u.userId, requestId: rid }));
  }
}
