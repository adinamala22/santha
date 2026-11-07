-- Rider SOS (ADR-031).
CREATE TABLE "rider_sos" (
    "id" UUID NOT NULL,
    "rider_user_id" UUID NOT NULL,
    "fulfilment_id" UUID,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "called_112" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "note" TEXT,

    CONSTRAINT "rider_sos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rider_sos_resolved_at_idx" ON "rider_sos"("resolved_at");
CREATE INDEX "rider_sos_rider_user_id_idx" ON "rider_sos"("rider_user_id");
