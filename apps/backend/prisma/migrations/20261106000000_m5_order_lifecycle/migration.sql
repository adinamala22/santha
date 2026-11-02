-- M5: merchant availability, order lifecycle fields, line substitutions, notifications (ADR-011)
-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "accepting_orders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "missed_in_a_row" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paused_at" TIMESTAMPTZ(6),
ADD COLUMN     "paused_reason" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "accepted_at" TIMESTAMPTZ(6),
ADD COLUMN     "fulfilment_mode" TEXT,
ADD COLUMN     "outcome_reason" TEXT,
ADD COLUMN     "pack_by" TIMESTAMPTZ(6),
ADD COLUMN     "ready_at" TIMESTAMPTZ(6),
ADD COLUMN     "refunded_paise" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "refund_paise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ok',
ADD COLUMN     "substitute_item_id" UUID,
ADD COLUMN     "substitute_name" TEXT,
ADD COLUMN     "substitute_unit_paise" INTEGER,
ADD COLUMN     "substitute_variant_id" UUID,
ADD COLUMN     "substitute_variant_label" TEXT;

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "merchant_id" UUID,
    "order_id" UUID,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "device_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "whatsapp_updates" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "notifications_order_id_created_at_idx" ON "notifications"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens"("user_id");

