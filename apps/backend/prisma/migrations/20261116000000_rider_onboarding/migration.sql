-- Rider onboarding (ADR-029). Riders who already exist were let in before onboarding existed: they start
-- approved. New riders start as a draft and need ops approval before they can go online.
ALTER TYPE "KycKind" ADD VALUE 'driving_licence';

ALTER TABLE "riders"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN "vehicle_number" TEXT,
  ADD COLUMN "status_note" TEXT,
  ADD COLUMN "submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN "decided_at" TIMESTAMPTZ(6),
  ADD COLUMN "decided_by" UUID;
ALTER TABLE "riders" ALTER COLUMN "status" SET DEFAULT 'draft';

CREATE INDEX "riders_status_idx" ON "riders"("status");
