-- CreateEnum
CREATE TYPE "MasterSource" AS ENUM ('seed', 'import', 'open_barcode', 'ops');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('pending_merchant', 'in_review', 'active', 'hidden');

-- CreateEnum
CREATE TYPE "ItemSource" AS ENUM ('merchant', 'master', 'import', 'ops');

-- CreateEnum
CREATE TYPE "FoodMark" AS ENUM ('veg', 'non_veg', 'egg');

-- CreateEnum
CREATE TYPE "ItemUnit" AS ENUM ('kg', 'g', 'l', 'ml', 'pc', 'pack', 'portion');

-- CreateEnum
CREATE TYPE "StockState" AS ENUM ('in', 'low', 'out');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('uploading', 'pending_review', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "photo_ids" UUID[] DEFAULT ARRAY[]::UUID[];

-- CreateTable
CREATE TABLE "master_products" (
    "id" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "mrp_paise" INTEGER,
    "pack_label" TEXT,
    "unit" "ItemUnit",
    "unit_qty" DOUBLE PRECISION,
    "category_slug" TEXT NOT NULL,
    "image_url" TEXT,
    "source" "MasterSource" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "master_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barcode_requests" (
    "id" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "scan_count" INTEGER NOT NULL DEFAULT 1,
    "last_merchant_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "master_product_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,

    CONSTRAINT "barcode_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "micro_market_id" UUID,
    "master_product_id" UUID,
    "name" TEXT NOT NULL,
    "name_te" TEXT,
    "description" TEXT,
    "brand" TEXT,
    "category_slug" TEXT NOT NULL,
    "food_mark" "FoodMark",
    "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "made_to_order" BOOLEAN NOT NULL DEFAULT false,
    "lead_time_min" INTEGER,
    "max_per_order" INTEGER,
    "available_days" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "daily_capacity" INTEGER,
    "special_on" TEXT,
    "status" "ItemStatus" NOT NULL,
    "review_reason" TEXT,
    "source" "ItemSource" NOT NULL,
    "image_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "confirmed_at" TIMESTAMPTZ(6) NOT NULL,
    "stale_since" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_variants" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "unit" "ItemUnit" NOT NULL,
    "unit_qty" DOUBLE PRECISION NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "mrp_paise" INTEGER,
    "stock" "StockState" NOT NULL DEFAULT 'in',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "item_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_slots" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "label" TEXT,
    "days" TEXT[],
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "cutoff_min" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kitchen_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "MediaStatus" NOT NULL,
    "content_type" TEXT NOT NULL,
    "original_key" TEXT NOT NULL,
    "variants" JSONB,
    "reject_reason" TEXT,
    "uploaded_by" UUID,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_products_barcode_key" ON "master_products"("barcode");

-- CreateIndex
CREATE INDEX "master_products_category_slug_idx" ON "master_products"("category_slug");

-- CreateIndex
CREATE UNIQUE INDEX "barcode_requests_barcode_key" ON "barcode_requests"("barcode");

-- CreateIndex
CREATE INDEX "barcode_requests_status_created_at_idx" ON "barcode_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "items_merchant_id_status_idx" ON "items"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "items_status_confirmed_at_idx" ON "items"("status", "confirmed_at");

-- CreateIndex
CREATE INDEX "item_variants_item_id_position_idx" ON "item_variants"("item_id", "position");

-- CreateIndex
CREATE INDEX "kitchen_slots_merchant_id_idx" ON "kitchen_slots"("merchant_id");

-- CreateIndex
CREATE INDEX "media_status_created_at_idx" ON "media"("status", "created_at");

-- CreateIndex
CREATE INDEX "media_merchant_id_idx" ON "media"("merchant_id");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_master_product_id_fkey" FOREIGN KEY ("master_product_id") REFERENCES "master_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_slots" ADD CONSTRAINT "kitchen_slots_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invariants the service also enforces (FR-CAT-6: selling price never above MRP).
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_price_positive" CHECK ("price_paise" > 0);
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_price_le_mrp" CHECK ("mrp_paise" IS NULL OR "price_paise" <= "mrp_paise");
ALTER TABLE "kitchen_slots" ADD CONSTRAINT "kitchen_slots_window" CHECK ("start" < "end" AND "capacity" > 0 AND "cutoff_min" >= 0);

-- analytics-config: discovery section of the micro-market config (ranking weights, ETA defaults).
ALTER TABLE "micro_market_versions" ADD COLUMN "discovery" JSONB NOT NULL DEFAULT '{}';
