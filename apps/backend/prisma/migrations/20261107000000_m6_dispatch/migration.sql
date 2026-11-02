-- M6: riders, fulfilments (self / rider / 3PL) and rider offers (ADR-012)
-- CreateTable
CREATE TABLE "riders" (
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL DEFAULT 'bike',
    "zones" UUID[],
    "online" BOOLEAN NOT NULL DEFAULT false,
    "rating" DOUBLE PRECISION,
    "offers_shown" INTEGER NOT NULL DEFAULT 0,
    "offers_accepted" INTEGER NOT NULL DEFAULT 0,
    "online_since" TIMESTAMPTZ(6),
    "online_min_today" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riders_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "fulfilments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "micro_market_id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "staff_id" UUID,
    "staff_token" TEXT,
    "rider_user_id" UUID,
    "tpl_ref" TEXT,
    "pickup_code" TEXT NOT NULL,
    "delivery_otp" TEXT NOT NULL,
    "fallback_stage" TEXT NOT NULL DEFAULT 'none',
    "self_bonus_paise" INTEGER NOT NULL DEFAULT 0,
    "store_to_drop_m" INTEGER NOT NULL,
    "rider_pay_paise" INTEGER NOT NULL DEFAULT 0,
    "pay_lines" JSONB NOT NULL DEFAULT '[]',
    "batched_with" UUID,
    "promised_at" TIMESTAMPTZ(6) NOT NULL,
    "eta_at" TIMESTAMPTZ(6),
    "delay_notified_at" TIMESTAMPTZ(6),
    "proof" TEXT,
    "proof_media_id" UUID,
    "cod_collected_paise" INTEGER,
    "last_lat" DOUBLE PRECISION,
    "last_lng" DOUBLE PRECISION,
    "last_location_at" TIMESTAMPTZ(6),
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_at" TIMESTAMPTZ(6),
    "arrived_at" TIMESTAMPTZ(6),
    "picked_up_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfilments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_offers" (
    "id" UUID NOT NULL,
    "fulfilment_id" UUID NOT NULL,
    "rider_user_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "pay_paise" INTEGER NOT NULL,
    "pay_lines" JSONB NOT NULL,
    "distance_m" INTEGER NOT NULL,
    "offered_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "dispatch_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fulfilments_order_id_key" ON "fulfilments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilments_staff_token_key" ON "fulfilments"("staff_token");

-- CreateIndex
CREATE INDEX "fulfilments_state_micro_market_id_idx" ON "fulfilments"("state", "micro_market_id");

-- CreateIndex
CREATE INDEX "fulfilments_rider_user_id_state_idx" ON "fulfilments"("rider_user_id", "state");

-- CreateIndex
CREATE INDEX "dispatch_offers_rider_user_id_state_idx" ON "dispatch_offers"("rider_user_id", "state");

-- CreateIndex
CREATE INDEX "dispatch_offers_fulfilment_id_idx" ON "dispatch_offers"("fulfilment_id");

-- AddForeignKey
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_fulfilment_id_fkey" FOREIGN KEY ("fulfilment_id") REFERENCES "fulfilments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

