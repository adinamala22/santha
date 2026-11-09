-- Tips, incentives and the rider cash limit (ADR-032).
ALTER TABLE "orders" ADD COLUMN "tip_paise" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "rider_cash_deposits" (
    "id" UUID NOT NULL,
    "rider_user_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "note" TEXT,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_cash_deposits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rider_cash_deposits_rider_user_id_created_at_idx" ON "rider_cash_deposits"("rider_user_id", "created_at");
