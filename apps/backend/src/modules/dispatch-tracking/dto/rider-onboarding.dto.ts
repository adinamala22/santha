import { z } from 'zod';
import { createZodDto } from '../../../common/zod-dto';
import { KycCheckSchema } from '../../merchant-catalogue/dto/merchants.dto';
import { RIDER_STATUSES } from '../dispatch.repository';
import { RIDER_VEHICLES } from '../rider-onboarding.service';

const iso = z.string().describe('ISO-8601 timestamp');

// ───────────── inputs ─────────────

export class RiderProfileDto extends createZodDto(
  z.object({
    name: z.string().trim().min(2).max(80),
    vehicle: z.enum(RIDER_VEHICLES),
    vehicleNumber: z.string().trim().max(20).optional().describe('Number plate; not needed for a cycle'),
  }),
) {}
export class DrivingLicenceDto extends createZodDto(z.object({ number: z.string().trim().min(10).max(24) })) {}
export class RiderReasonDto extends createZodDto(
  z.object({ reason: z.string().trim().min(5).max(300).describe('Shown to the rider') }),
) {}
export class RiderApproveDto extends createZodDto(z.object({ note: z.string().trim().max(300).optional() })) {}
export class OpsRiderQueryDto extends createZodDto(
  z.object({ status: z.string().optional().describe('Comma-separated: draft, submitted, approved, rejected, suspended') }),
) {}

// ───────────── outputs ─────────────

const step = z.object({ key: z.enum(['profile', 'selfie', 'identity', 'driving_licence', 'bank']), done: z.boolean() });

export const RiderOnboardingSchema = z.object({
  status: z.enum(RIDER_STATUSES),
  statusNote: z.string().nullable(),
  name: z.string(),
  vehicle: z.enum(RIDER_VEHICLES),
  vehicleNumber: z.string().nullable(),
  editable: z.boolean().describe('Details can change only before submitting or after a rejection'),
  steps: z.array(step),
  checks: z.array(KycCheckSchema),
  photos: z.object({ selfie: z.boolean(), licence: z.boolean() }).describe('Which sign-up photos are in (ADR-030)'),
  submittedAt: iso.nullable(),
});
export class RiderOnboardingDto extends createZodDto(RiderOnboardingSchema) {}

const OpsRiderRow = z.object({
  userId: z.uuid(),
  name: z.string(),
  phoneMasked: z.string(),
  vehicle: z.enum(RIDER_VEHICLES),
  vehicleNumber: z.string().nullable(),
  status: z.enum(RIDER_STATUSES),
  online: z.boolean(),
  rating: z.number().nullable(),
  submittedAt: iso.nullable(),
  decidedAt: iso.nullable(),
});
export class OpsRiderListDto extends createZodDto(z.object({ items: z.array(OpsRiderRow) })) {}
export class OpsRiderDto extends createZodDto(
  RiderOnboardingSchema.extend(OpsRiderRow.shape).extend({
    selfieUrl: z.string().nullable().describe('Short-lived link (5 min)'),
    licenceUrl: z.string().nullable().describe('Short-lived link (5 min) to the licence card photo'),
  }),
) {}

// ───────────── photos (ADR-030) ─────────────

export class RiderPhotoRequestDto extends createZodDto(
  z.object({
    kind: z.enum(['selfie', 'licence', 'delivery']),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    fulfilmentId: z.uuid().optional().describe('Required for a door photo (kind delivery)'),
  }),
) {}
const RiderPhotoSchema = z.object({ id: z.uuid(), kind: z.enum(['selfie', 'licence', 'delivery']), status: z.enum(['uploading', 'ready']) });
export class RiderPhotoDto extends createZodDto(RiderPhotoSchema) {}
export class RiderPhotoTicketDto extends createZodDto(
  z.object({
    photo: RiderPhotoSchema,
    upload: z.object({ url: z.string(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()), expiresAt: iso }),
  }),
) {}
