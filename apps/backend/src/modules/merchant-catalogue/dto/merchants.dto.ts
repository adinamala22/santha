import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { WeeklyHoursSchema } from '../../../common/hours';
import { maskPhone } from '../../../common/pii';
import type { KycCheckRecord } from '../../identity-kyc/kyc.service';
import { REJECTION_CODES, RETAIL_CATEGORIES } from '../domain/merchant';
import type { MediaView } from '../media.service';
import type { MerchantView } from '../merchants.service';

const merchantType = z.enum(['retail', 'fashion', 'home_business', 'home_kitchen']);
const fulfilment = z.enum(['self', 'rider']);
const status = z.enum(['draft', 'submitted', 'approved', 'rejected', 'live']);
const iso = z.iso.datetime();
const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export const CreateMerchantSchema = z.object({
  type: merchantType,
  name: z.string().trim().min(2).max(80),
  sellsFood: z.boolean().optional().describe('Retail/home business that sells food (needs FSSAI). Always true for home kitchens.'),
  category: z.enum(RETAIL_CATEGORIES).nullable().optional().describe('Retail only'),
});
export class CreateMerchantDto extends createZodDto(CreateMerchantSchema) {}

export const UpdateMerchantSchema = z
  .object({
    type: merchantType,
    sellsFood: z.boolean(),
    category: z.enum(RETAIL_CATEGORIES).nullable(),
    name: z.string().trim().min(2).max(80),
    nameTe: z.string().trim().max(80).nullable(),
    description: z.string().trim().max(500).nullable(),
    location: latLng,
    addressLine: z.string().trim().min(5).max(200),
    landmark: z.string().trim().max(120).nullable(),
    pincode: z.string().regex(/^5\d{5}$/, 'Andhra Pradesh pincodes start with 5'),
    returnPolicy: z.string().trim().max(1000).nullable(),
    hygieneDeclared: z.boolean().describe('Home kitchens: hygiene self-declaration (FR-TRS-2)'),
    hours: WeeklyHoursSchema,
    radiusM: z.number().int().min(500).max(10_000),
    movPaise: z.number().int().min(0).max(100_000).describe('Minimum order value, paise'),
    defaultFulfilment: fulfilment,
  })
  .partial();
export class UpdateMerchantDto extends createZodDto(UpdateMerchantSchema) {}

export class PanDto extends createZodDto(z.object({ pan: z.string().trim().min(10).max(10), name: z.string().trim().min(2).max(100) })) {}
export class AadhaarStartDto extends createZodDto(z.object({ aadhaar: z.string().trim().min(12).max(14) })) {}
export class AadhaarVerifyDto extends createZodDto(z.object({ otp: z.string().regex(/^\d{6}$/) })) {}
export class GstinDto extends createZodDto(z.object({ gstin: z.string().trim().length(15) })) {}
export class GstExemptionDto extends createZodDto(
  z.object({ reason: z.string().trim().min(5).max(300).describe('e.g. turnover below the GST threshold') }),
) {}
export class LicenceNumberDto extends createZodDto(z.object({ number: z.string().trim().min(5).max(40) })) {}
export class BankDto extends createZodDto(
  z.object({
    accountNumber: z.string().trim().min(9).max(20),
    ifsc: z.string().trim().length(11),
    holderName: z.string().trim().min(2).max(100),
  }),
) {}
export class AddStaffDto extends createZodDto(
  z.object({ name: z.string().trim().min(2).max(80), phone: z.string().min(10).max(16) }),
) {}

export const KycCheckSchema = z.object({
  kind: z.enum(['pan', 'aadhaar', 'gstin', 'gst_exemption', 'fssai', 'bank', 'drug_licence']),
  status: z.enum(['pending', 'verified', 'failed']),
  valueMasked: z.string().nullable(),
  valuePublic: z.string().nullable(),
  nameOnRecord: z.string().nullable(),
  provider: z.string(),
  failureReason: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  verifiedAt: iso.nullable(),
  updatedAt: iso,
});
export class KycCheckDto extends createZodDto(KycCheckSchema) {}

const StaffSchema = z.object({ id: z.uuid(), name: z.string(), phoneMasked: z.string(), active: z.boolean() });
export class StaffDto extends createZodDto(StaffSchema) {}

export const MerchantSchema = z.object({
  id: z.uuid(),
  type: merchantType,
  sellsFood: z.boolean(),
  category: z.string().nullable(),
  name: z.string(),
  nameTe: z.string().nullable(),
  description: z.string().nullable(),
  addressLine: z.string().nullable(),
  landmark: z.string().nullable(),
  pincode: z.string().nullable(),
  location: latLng.nullable(),
  radiusM: z.number().int(),
  hours: WeeklyHoursSchema.nullable(),
  movPaise: z.number().int(),
  defaultFulfilment: fulfilment,
  returnPolicy: z.string().nullable(),
  hygieneDeclaredAt: iso.nullable(),
  status,
  submittedAt: iso.nullable(),
  decidedAt: iso.nullable(),
  rejectionCode: z.string().nullable(),
  rejectionNote: z.string().nullable(),
  liveAt: iso.nullable(),
  createdAt: iso,
});

export const MediaSchema = z.object({
  id: z.uuid(),
  purpose: z.enum(['item', 'store']),
  status: z.enum(['uploading', 'pending_review', 'approved', 'rejected']),
  rejectReason: z.string().nullable(),
  thumbUrl: z.string().nullable().describe('Absolute URL, or a path starting with / to resolve against the API base (fake mode)'),
  mediumUrl: z.string().nullable(),
  createdAt: iso,
});
export const toMediaDto = (m: MediaView) => ({ ...m, createdAt: m.createdAt.toISOString() });

export const MerchantViewSchema = z.object({
  merchant: MerchantSchema,
  microMarket: z.object({ id: z.uuid(), slug: z.string(), name: z.string(), nameTe: z.string() }).nullable(),
  staff: z.array(StaffSchema),
  kyc: z.array(KycCheckSchema),
  checklist: z.array(z.object({ key: z.string(), done: z.boolean() })),
  canSubmit: z.boolean(),
  photos: z.array(MediaSchema),
});
export class MerchantViewDto extends createZodDto(MerchantViewSchema) {}
export class MerchantListDto extends createZodDto(z.object({ items: z.array(MerchantViewSchema) })) {}

export const OpsQueueQuerySchema = z.object({
  status: status.optional(),
  microMarketId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export class OpsQueueQueryDto extends createZodDto(OpsQueueQuerySchema) {}
export class ApproveDto extends createZodDto(z.object({ note: z.string().trim().max(500).optional() })) {}
export class RejectDto extends createZodDto(
  z.object({ reasonCode: z.enum(REJECTION_CODES), note: z.string().trim().max(500).optional() }),
) {}

// ── mappers ──
const isoOrNull = (d: Date | null) => d?.toISOString() ?? null;

export const toKycDto = (c: KycCheckRecord) => ({
  kind: c.kind,
  status: c.status,
  valueMasked: c.valueMasked,
  valuePublic: c.valuePublic,
  nameOnRecord: c.nameOnRecord,
  provider: c.provider,
  failureReason: c.failureReason,
  details: c.details,
  verifiedAt: isoOrNull(c.verifiedAt),
  updatedAt: c.updatedAt.toISOString(),
});

export const toViewDto = (v: MerchantView) => {
  const m = v.merchant;
  return {
    merchant: {
      id: m.id,
      type: m.type,
      sellsFood: m.sellsFood,
      category: m.category,
      name: m.name,
      nameTe: m.nameTe,
      description: m.description,
      addressLine: m.addressLine,
      landmark: m.landmark,
      pincode: m.pincode,
      location: m.location,
      radiusM: m.radiusM,
      hours: m.hours,
      movPaise: m.movPaise,
      defaultFulfilment: m.defaultFulfilment,
      returnPolicy: m.returnPolicy,
      hygieneDeclaredAt: isoOrNull(m.hygieneDeclaredAt),
      status: m.status,
      submittedAt: isoOrNull(m.submittedAt),
      decidedAt: isoOrNull(m.decidedAt),
      rejectionCode: m.rejectionCode,
      rejectionNote: m.rejectionNote,
      liveAt: isoOrNull(m.liveAt),
      createdAt: m.createdAt.toISOString(),
    },
    microMarket: v.microMarket,
    staff: v.staff.map((s) => ({ id: s.id, name: s.name, phoneMasked: maskPhone(s.phone), active: s.active })),
    kyc: v.kyc.map(toKycDto),
    checklist: v.checklist,
    canSubmit: (m.status === 'draft' || m.status === 'rejected') && v.checklist.every((i) => i.done),
    photos: v.photos.map(toMediaDto),
  };
};
