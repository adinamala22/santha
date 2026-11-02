import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { type AuthUser, CurrentUser, RequestId, Roles } from '../../common/auth/decorators';
import { type CartView, CartPricingService, MAX_CART_LINES, MAX_LINE_QTY } from './cart-pricing.service';
import { SUBSTITUTIONS } from './domain/pricing';
import type { PromoRecord } from './domain/promo';

const iso = z.iso.datetime();
const substitution = z.enum(SUBSTITUTIONS as [string, ...string[]]);

// ───────────── cart ─────────────

const PutCartSchema = z.object({
  merchantId: z.uuid(),
  lines: z
    .array(
      z.object({
        itemId: z.uuid(),
        variantId: z.uuid(),
        quantity: z.number().int().min(1).max(MAX_LINE_QTY),
        substitution: substitution.default('call_me').describe('If unavailable when packing: call_me | similar | remove'),
      }),
    )
    .max(MAX_CART_LINES)
    .describe('The whole cart (replaces what is stored); empty = clear'),
  replace: z.boolean().optional().describe('Start a new cart when the stored one is from another store'),
});
export class PutCartDto extends createZodDto(PutCartSchema) {}

export const CartLineSchema = z.object({
  itemId: z.uuid(),
  variantId: z.uuid(),
  name: z.string(),
  nameTe: z.string().nullable(),
  variantLabel: z.string(),
  quantity: z.number().int(),
  unitPricePaise: z.number().int(),
  mrpPaise: z.number().int().nullable(),
  linePaise: z.number().int(),
  stock: z.enum(['in', 'low', 'out']),
  stale: z.boolean(),
  available: z.boolean(),
  maxPerOrder: z.number().int().nullable(),
  substitution,
  imageUrl: z.string().nullable(),
  foodMark: z.enum(['veg', 'non_veg', 'egg']).nullable(),
});

export class CartDto extends createZodDto(
  z.object({
    merchant: z.object({ id: z.uuid(), name: z.string(), nameTe: z.string().nullable(), type: z.string(), movPaise: z.number().int() }).nullable(),
    lines: z.array(CartLineSchema),
    itemsPaise: z.number().int(),
    itemCount: z.number().int(),
    updatedAt: iso.nullable(),
  }),
) {}

export const toCartDto = (v: CartView) => ({
  merchant: v.merchant ? { id: v.merchant.id, name: v.merchant.name, nameTe: v.merchant.nameTe, type: v.merchant.type, movPaise: v.merchant.movPaise } : null,
  lines: v.lines.map((l) => ({
    itemId: l.itemId,
    variantId: l.variantId,
    name: l.name,
    nameTe: l.nameTe,
    variantLabel: l.variantLabel,
    quantity: l.quantity,
    unitPricePaise: l.unitPricePaise,
    mrpPaise: l.mrpPaise,
    linePaise: l.linePaise,
    stock: l.stock,
    stale: l.stale,
    available: l.available,
    maxPerOrder: l.maxPerOrder,
    substitution: l.substitution,
    imageUrl: l.meta.imageUrl,
    foodMark: (l.meta.foodMark as 'veg' | 'non_veg' | 'egg' | null) ?? null,
  })),
  itemsPaise: v.itemsPaise,
  itemCount: v.itemCount,
  updatedAt: v.cart?.updatedAt.toISOString() ?? null,
});

/** The signed-in consumer's cart (one store at a time). */
@ApiTags('cart')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Controller('cart')
export class CartController {
  constructor(private readonly pricing: CartPricingService) {}

  @Get()
  @ZodResponse({ type: CartDto })
  async get(@CurrentUser() u: AuthUser) {
    return toCartDto(await this.pricing.getCart(u.userId));
  }

  @Put()
  @ZodResponse({ type: CartDto, description: 'Replace the cart. 409 CART_CONFLICT when it holds another store (send replace: true to start over).' })
  async put(@Body() b: PutCartDto, @CurrentUser() u: AuthUser) {
    return toCartDto(await this.pricing.putCart(u.userId, { merchantId: b.merchantId, lines: b.lines as never, replace: b.replace }));
  }

  @Delete()
  @HttpCode(204)
  async clear(@CurrentUser() u: AuthUser): Promise<void> {
    await this.pricing.clearCart(u.userId);
  }
}

// ───────────── ops: promos ─────────────

const paise = z.number().int().min(0);
/** Field types without defaults: PATCH must leave omitted fields alone. */
const promoFields = {
  description: z.string().trim().min(3).max(120),
  descriptionTe: z.string().trim().min(3).max(120),
  kind: z.enum(['flat', 'percent']),
  value: z.number().int().min(1).describe('flat: paise off; percent: whole percent'),
  maxDiscountPaise: paise.nullable(),
  minOrderPaise: paise,
  budgetPaise: paise.nullable().describe('Total discount this code may give; null = unlimited'),
  perUserLimit: z.number().int().min(1).max(100),
  firstOrderOnly: z.boolean(),
  merchantSharePercent: z.number().int().min(0).max(100),
  microMarketIds: z.array(z.uuid()),
  merchantTypes: z.array(z.enum(['retail', 'fashion', 'home_business', 'home_kitchen'])),
  merchantIds: z.array(z.uuid()),
  validFrom: z.iso.datetime({ offset: true }),
  validTo: z.iso.datetime({ offset: true }).nullable(),
  active: z.boolean(),
};
const PromoInputSchema = z.object({
  ...promoFields,
  code: z.string().trim().regex(/^[A-Za-z0-9]{4,20}$/, '4–20 letters or digits'),
  maxDiscountPaise: promoFields.maxDiscountPaise.default(null),
  minOrderPaise: promoFields.minOrderPaise.default(0),
  budgetPaise: promoFields.budgetPaise.default(null),
  perUserLimit: promoFields.perUserLimit.default(1),
  firstOrderOnly: promoFields.firstOrderOnly.default(false),
  merchantSharePercent: promoFields.merchantSharePercent.default(0),
  microMarketIds: promoFields.microMarketIds.default([]),
  merchantTypes: promoFields.merchantTypes.default([]),
  merchantIds: promoFields.merchantIds.default([]),
  validTo: promoFields.validTo.default(null),
  active: promoFields.active.optional(),
});
export class PromoInputDto extends createZodDto(PromoInputSchema) {}
export class PromoPatchDto extends createZodDto(z.object(promoFields).partial()) {}

const PromoSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  description: z.string(),
  descriptionTe: z.string(),
  kind: z.enum(['flat', 'percent']),
  value: z.number().int(),
  maxDiscountPaise: z.number().int().nullable(),
  minOrderPaise: z.number().int(),
  budgetPaise: z.number().int().nullable(),
  spentPaise: z.number().int(),
  remainingPaise: z.number().int().nullable(),
  perUserLimit: z.number().int(),
  firstOrderOnly: z.boolean(),
  merchantSharePercent: z.number().int(),
  microMarketIds: z.array(z.uuid()),
  merchantTypes: z.array(z.string()),
  merchantIds: z.array(z.uuid()),
  validFrom: iso,
  validTo: iso.nullable(),
  active: z.boolean(),
  status: z.enum(['active', 'paused', 'scheduled', 'expired', 'exhausted']),
  createdAt: iso,
});
export class PromoDto extends createZodDto(PromoSchema) {}
export class PromoListDto extends createZodDto(z.object({ items: z.array(PromoSchema) })) {}

export function promoStatus(p: PromoRecord, now: Date): z.infer<typeof PromoSchema>['status'] {
  if (!p.active) return 'paused';
  if (now < p.validFrom) return 'scheduled';
  if (p.validTo && now >= p.validTo) return 'expired';
  if (p.budgetPaise != null && p.spentPaise >= p.budgetPaise) return 'exhausted';
  return 'active';
}

const toPromoDto = (p: PromoRecord, now = new Date()) => ({
  ...p,
  merchantTypes: p.merchantTypes as string[],
  remainingPaise: p.budgetPaise == null ? null : Math.max(0, p.budgetPaise - p.spentPaise),
  validFrom: p.validFrom.toISOString(),
  validTo: p.validTo?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
  status: promoStatus(p, now),
});

/** Ops console: coupon codes with budgets (/admin/promos). Every change writes an audit row. */
@ApiTags('ops')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Device-Id', required: true })
@Roles('admin', 'ops', 'finance')
@Controller('ops/promos')
export class OpsPromosController {
  constructor(private readonly pricing: CartPricingService) {}

  @Get()
  @ZodResponse({ type: PromoListDto })
  async list() {
    return { items: (await this.pricing.listPromos()).map((p) => toPromoDto(p)) };
  }

  @Post()
  @Roles('admin', 'finance')
  @ZodResponse({ status: 201, type: PromoDto })
  async create(@Body() b: PromoInputDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    return toPromoDto(await this.pricing.createPromo({ ...b, validFrom: new Date(b.validFrom), validTo: b.validTo ? new Date(b.validTo) : null } as never, { userId: u.userId, requestId }));
  }

  @Patch(':id')
  @ZodResponse({ type: PromoDto, description: 'Edit, pause (active: false) or resume a promo' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() b: PromoPatchDto, @CurrentUser() u: AuthUser, @RequestId() requestId: string | null) {
    const patch = {
      ...b,
      ...(b.validFrom !== undefined ? { validFrom: new Date(b.validFrom) } : {}),
      ...(b.validTo !== undefined ? { validTo: b.validTo ? new Date(b.validTo) : null } : {}),
    };
    return toPromoDto(await this.pricing.updatePromo(id, patch as never, { userId: u.userId, requestId }));
  }
}
