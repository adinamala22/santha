-- M4: carts, quotes, promos, orders, payment intents, webhooks, wallet (ADR-010)
-- CreateEnum
CREATE TYPE "PromoKind" AS ENUM ('flat', 'percent');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('reserved', 'confirmed', 'released');

-- CreateEnum
CREATE TYPE "OrderState" AS ENUM ('AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED_DELIVERY');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('online', 'cod');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('created', 'captured', 'failed');

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "packaging_fee_paise" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "carts" (
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "lines" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "micro_market_id" UUID NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promos" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "description_te" TEXT NOT NULL,
    "kind" "PromoKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "max_discount_paise" INTEGER,
    "min_order_paise" INTEGER NOT NULL DEFAULT 0,
    "budget_paise" INTEGER,
    "spent_paise" INTEGER NOT NULL DEFAULT 0,
    "per_user_limit" INTEGER NOT NULL DEFAULT 1,
    "first_order_only" BOOLEAN NOT NULL DEFAULT false,
    "merchant_share_percent" INTEGER NOT NULL DEFAULT 0,
    "micro_market_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "merchant_types" "MerchantType"[] DEFAULT ARRAY[]::"MerchantType"[],
    "merchant_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_to" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "discount_paise" INTEGER NOT NULL,
    "merchant_share_paise" INTEGER NOT NULL,
    "status" "RedemptionStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "micro_market_id" UUID NOT NULL,
    "state" "OrderState" NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "fulfilment_when" TEXT NOT NULL,
    "slot_id" UUID,
    "slot_date" TEXT,
    "slot_starts_at" TIMESTAMPTZ(6),
    "address" JSONB NOT NULL,
    "instructions" TEXT,
    "items_paise" INTEGER NOT NULL,
    "fees_paise" INTEGER NOT NULL,
    "tax_paise" INTEGER NOT NULL,
    "discount_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "promo_code" TEXT,
    "quote" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "placed_at" TIMESTAMPTZ(6),
    "payment_due_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "variant_label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_paise" INTEGER NOT NULL,
    "mrp_paise" INTEGER,
    "line_paise" INTEGER NOT NULL,
    "substitution" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_transitions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from" "OrderState",
    "to" "OrderState" NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "reason" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
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

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "order_id" UUID,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotes_user_id_created_at_idx" ON "quotes"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "promos_code_key" ON "promos"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemptions_order_id_key" ON "promo_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "promo_redemptions_promo_id_user_id_idx" ON "promo_redemptions"("promo_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_code_key" ON "orders"("code");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_merchant_id_state_idx" ON "orders"("merchant_id", "state");

-- CreateIndex
CREATE INDEX "orders_state_payment_due_at_idx" ON "orders"("state", "payment_due_at");

-- CreateIndex
CREATE INDEX "orders_merchant_id_slot_id_slot_date_idx" ON "orders"("merchant_id", "slot_id", "slot_date");

-- CreateIndex
CREATE UNIQUE INDEX "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "order_lines_order_id_idx" ON "order_lines"("order_id");

-- CreateIndex
CREATE INDEX "order_transitions_order_id_at_idx" ON "order_transitions"("order_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_order_id_key" ON "payment_intents"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_provider_order_id_key" ON "payment_intents"("provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key" ON "webhook_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "wallet_entries_user_id_created_at_idx" ON "wallet_entries"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_transitions" ADD CONSTRAINT "order_transitions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Promo budgets can never go negative or over budget (compare-and-swap in PromoRepository.reserve).
ALTER TABLE "promos" ADD CONSTRAINT "promos_spent_within_budget" CHECK ("spent_paise" >= 0 AND ("budget_paise" IS NULL OR "spent_paise" <= "budget_paise"));
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_nonnegative" CHECK ("total_paise" >= 0);
