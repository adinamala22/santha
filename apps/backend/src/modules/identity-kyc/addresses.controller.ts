import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { createZodDto } from '../../common/zod-dto';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../../common/auth/decorators';
import { type AddressView, AddressesService } from './addresses.service';

const label = z.enum(['home', 'work', 'other']);
const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const AddressInputSchema = z.object({
  label,
  name: z.string().trim().max(30).nullable().optional().describe('Custom name when label is "other"'),
  line: z.string().trim().min(5).max(200).describe('House / flat, building, street'),
  landmark: z.string().trim().max(120).nullable().optional(),
  pincode: z.string().regex(/^\d{6}$/).nullable().optional(),
  location: latLng,
  isDefault: z.boolean().optional(),
  leaveAtDoor: z.boolean().optional().describe('Prepaid orders to this address may be left at the door (ADR-036)'),
});
export class AddressInputDto extends createZodDto(AddressInputSchema) {}
export class AddressPatchDto extends createZodDto(AddressInputSchema.partial()) {}

const AddressSchema = z.object({
  id: z.uuid(),
  label,
  name: z.string().nullable(),
  line: z.string(),
  landmark: z.string().nullable(),
  pincode: z.string().nullable(),
  location: latLng,
  isDefault: z.boolean(),
  leaveAtDoor: z.boolean(),
  serviceable: z.boolean(),
  microMarket: z.object({ id: z.uuid(), slug: z.string(), name: z.string(), nameTe: z.string() }).nullable(),
});
export class AddressDto extends createZodDto(AddressSchema) {}
export class AddressListDto extends createZodDto(z.object({ items: z.array(AddressSchema) })) {}

const toDto = (v: AddressView) => ({
  id: v.address.id,
  label: v.address.label,
  name: v.address.name,
  line: v.address.line,
  landmark: v.address.landmark,
  pincode: v.address.pincode,
  location: v.address.location,
  isDefault: v.address.isDefault,
  leaveAtDoor: v.address.leaveAtDoor,
  serviceable: !!v.microMarket,
  microMarket: v.microMarket,
});

/** Saved delivery addresses of the signed-in user (FR-LOC-1). */
@ApiTags('me')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('me/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ZodResponse({ type: AddressListDto })
  async list(@CurrentUser() u: AuthUser) {
    return { items: (await this.addresses.list(u.userId)).map(toDto) };
  }

  @Post()
  @ZodResponse({ status: 201, type: AddressDto })
  async create(@Body() b: AddressInputDto, @CurrentUser() u: AuthUser) {
    return toDto(await this.addresses.create(u.userId, b));
  }

  @Patch(':id')
  @ZodResponse({ type: AddressDto })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() b: AddressPatchDto, @CurrentUser() u: AuthUser) {
    return toDto(await this.addresses.update(u.userId, id, b));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser): Promise<void> {
    await this.addresses.remove(u.userId, id);
  }
}
