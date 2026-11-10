-- Tip after delivery (ADR-037): a separate payment, 100% to the rider.
CREATE TABLE "tip_payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rider_user_id" UUID NOT NULL,
    "micro_market_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "provider" TEXT NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "status" "PaymentStatus" NOT NULL,
    "failure_reason" TEXT,
    "captured_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tip_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tip_payments_provider_order_id_key" ON "tip_payments"("provider_order_id");
CREATE INDEX "tip_payments_order_id_idx" ON "tip_payments"("order_id");
CREATE INDEX "tip_payments_rider_user_id_captured_at_idx" ON "tip_payments"("rider_user_id", "captured_at");
