-- On-call paging for rider SOS (ADR-034).
ALTER TABLE "rider_sos" ADD COLUMN "paged_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rider_sos" ADD COLUMN "paged_at" TIMESTAMPTZ(6);
