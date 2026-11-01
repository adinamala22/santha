import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser, CurrentUser, Public } from '../../common/auth/decorators';
import { maskPhone } from '../../common/pii';
import { AuthService } from './auth.service';
import type { UserRecord } from './identity.repository';
import {
  AuthSessionDto,
  MeDto,
  OtpChallengeDto,
  OtpRequestDto,
  OtpVerifyDto,
  RefreshDto,
  TokenPairDto,
} from './dto/auth.dto';

const toMe = (u: UserRecord) => ({
  id: u.id,
  phoneMasked: maskPhone(u.phone),
  name: u.name,
  locale: u.locale,
  roles: u.roles,
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @ZodResponse({ status: 200, type: OtpChallengeDto, description: 'OTP sent' })
  requestOtp(@Body() body: OtpRequestDto, @Req() req: Request) {
    return this.auth.requestOtp({ ...body, ip: req.ip ?? 'unknown' });
  }

  @Public()
  @Post('otp/verify')
  @ZodResponse({ status: 200, type: AuthSessionDto, description: 'Signed in' })
  async verifyOtp(@Body() body: OtpVerifyDto) {
    const r = await this.auth.verifyOtp(body);
    return { ...r, user: toMe(r.user) };
  }

  @Public()
  @Post('refresh')
  @ZodResponse({ status: 200, type: TokenPairDto, description: 'Rotated tokens' })
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refreshToken, body.deviceId);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiHeader({ name: 'X-Device-Id', required: true })
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logout(user.sessionId);
  }
}

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @ApiBearerAuth()
  @ApiHeader({ name: 'X-Device-Id', required: true })
  @ZodResponse({ type: MeDto })
  async me(@CurrentUser() user: AuthUser) {
    return toMe(await this.auth.me(user.userId));
  }
}
