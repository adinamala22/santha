-- CreateEnum
CREATE TYPE "KycSubject" AS ENUM ('merchant', 'rider');

-- CreateEnum
CREATE TYPE "KycKind" AS ENUM ('pan', 'aadhaar', 'gstin', 'gst_exemption', 'fssai', 'bank', 'drug_licence');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('pending', 'verified', 'failed');

-- CreateEnum
CREATE TYPE "MerchantType" AS ENUM ('retail', 'fashion', 'home_business', 'home_kitchen');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'live');

-- CreateEnum
CREATE TYPE "FulfilmentMode" AS ENUM ('self', 'rider');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email" TEXT,
ADD COLUMN     "password_hash" TEXT;

-- CreateTable
CREATE TABLE "kyc_checks" (
    "id" UUID NOT NULL,
    "subject_type" "KycSubject" NOT NULL,
    "subject_id" UUID NOT NULL,
    "kind" "KycKind" NOT NULL,
    "status" "KycStatus" NOT NULL,
    "value_masked" TEXT,
    "value_public" TEXT,
    "name_on_record" TEXT,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "failure_reason" TEXT,
    "details" JSONB,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kyc_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_te" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "micro_markets" (
    "id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_te" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "micro_markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "micro_market_versions" (
    "id" UUID NOT NULL,
    "micro_market_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "polygon" geography(Polygon, 4326),
    "hours" JSONB NOT NULL,
    "fees" JSONB NOT NULL,
    "cod" JSONB NOT NULL,
    "sla" JSONB NOT NULL,
    "rider_pay" JSONB NOT NULL,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "micro_market_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "micro_market_id" UUID,
    "type" "MerchantType" NOT NULL,
    "sells_food" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "name" TEXT NOT NULL,
    "name_te" TEXT,
    "description" TEXT,
    "address_line" TEXT,
    "landmark" TEXT,
    "pincode" TEXT,
    "location" geography(Point, 4326),
    "radius_m" INTEGER NOT NULL DEFAULT 3000,
    "hours" JSONB,
    "mov_paise" INTEGER NOT NULL DEFAULT 0,
    "default_fulfilment" "FulfilmentMode" NOT NULL DEFAULT 'rider',
    "return_policy" TEXT,
    "hygiene_declared_at" TIMESTAMPTZ(6),
    "status" "MerchantStatus" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "rejection_code" TEXT,
    "rejection_note" TEXT,
    "live_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_staff" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kyc_checks_subject_type_subject_id_kind_key" ON "kyc_checks"("subject_type", "subject_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "cities_slug_key" ON "cities"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "micro_markets_slug_key" ON "micro_markets"("slug");

-- CreateIndex
CREATE INDEX "micro_markets_city_id_idx" ON "micro_markets"("city_id");

-- CreateIndex
CREATE INDEX "micro_market_versions_micro_market_id_effective_from_idx" ON "micro_market_versions"("micro_market_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "micro_market_versions_micro_market_id_version_key" ON "micro_market_versions"("micro_market_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_owner_user_id_key" ON "merchants"("owner_user_id");

-- CreateIndex
CREATE INDEX "merchants_status_submitted_at_idx" ON "merchants"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "merchants_micro_market_id_status_idx" ON "merchants"("micro_market_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_staff_merchant_id_phone_key" ON "merchant_staff"("merchant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "micro_markets" ADD CONSTRAINT "micro_markets_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "micro_market_versions" ADD CONSTRAINT "micro_market_versions_micro_market_id_fkey" FOREIGN KEY ("micro_market_id") REFERENCES "micro_markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_staff" ADD CONSTRAINT "merchant_staff_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written (Prisma cannot express these):
-- spatial indexes for serviceability (ST_Covers) and nearest-store queries
CREATE INDEX "micro_market_versions_polygon_gist" ON "micro_market_versions" USING GIST ("polygon");
CREATE INDEX "merchants_location_gist" ON "merchants" USING GIST ("location");
-- a version's validity window must be non-empty
ALTER TABLE "micro_market_versions"
  ADD CONSTRAINT "micro_market_versions_window_chk" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");
