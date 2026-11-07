-- Rider photos (ADR-030): private selfie / licence card / door photo, and "arrived at the customer".
CREATE TABLE "rider_photos" (
    "id" UUID NOT NULL,
    "rider_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "fulfilment_id" UUID,
    "status" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "original_key" TEXT NOT NULL,
    "key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rider_photos_rider_user_id_kind_idx" ON "rider_photos"("rider_user_id", "kind");
CREATE INDEX "rider_photos_fulfilment_id_idx" ON "rider_photos"("fulfilment_id");

ALTER TABLE "fulfilments" ADD COLUMN "arrived_drop_at" TIMESTAMPTZ(6);
