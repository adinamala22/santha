import { Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { createZodDto } from '../../common/zod-dto';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../../common/auth/decorators';
import { NotificationsService } from './notifications.service';

export class PushTokenDto extends createZodDto(z.object({ token: z.string().min(10).max(4096), platform: z.enum(['android', 'ios', 'web']) })) {}
export class PreferencesDto extends createZodDto(z.object({ whatsappUpdates: z.boolean().describe('Order updates on WhatsApp (explicit opt-in)') })) {}

/** Device push registration and notification preferences of the signed-in user. */
@ApiTags('me')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('me')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Put('push-token')
  @HttpCode(204)
  async pushToken(@Body() b: PushTokenDto, @CurrentUser() u: AuthUser): Promise<void> {
    await this.notifications.registerToken(u.userId, u.deviceId, b.token, b.platform);
  }

  /** Sign-out on this phone (the app calls it before logging out): its notifications stop. */
  @Delete('push-token')
  @HttpCode(204)
  async removePushToken(@CurrentUser() u: AuthUser): Promise<void> {
    await this.notifications.unregisterToken(u.userId, u.deviceId);
  }

  @Get('notification-preferences')
  @ZodResponse({ type: PreferencesDto })
  async prefs(@CurrentUser() u: AuthUser) {
    return { whatsappUpdates: await this.notifications.whatsappOptIn(u.userId) };
  }

  @Put('notification-preferences')
  @ZodResponse({ type: PreferencesDto })
  async setPrefs(@Body() b: PreferencesDto, @CurrentUser() u: AuthUser) {
    await this.notifications.setWhatsappOptIn(u.userId, b.whatsappUpdates);
    return { whatsappUpdates: b.whatsappUpdates };
  }
}
