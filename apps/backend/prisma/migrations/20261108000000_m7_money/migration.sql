-- M7: settlement runs, payouts, refunds (four-eyes), reconciliation, disputes, issues, ratings (ADR-013)
-- AlterTable
ALTER TABLE "riders" ADD COLUMN     "payout_cadence" TEXT NOT NULL DEFAULT 'weekly';

-- CreateTable
CREATE TABLE "settlement_runs" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL,
    "totals" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "settlement_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "party_type" TEXT NOT NULL,
    "party_id" UUID NOT NULL,
    "micro_market_id" UUID,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "gross_paise" INTEGER NOT NULL,
    "net_paise" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "tcs_paise" INTEGER NOT NULL DEFAULT 0,
    "tds_paise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "transfer_ref" TEXT,
    "failure_reason" TEXT,
    "statement_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transferred_at" TIMESTAMPTZ(6),

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_requests" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "issue_id" UUID,
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "micro_market_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "destination" TEXT NOT NULL,
    "liability" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "rejected_by" UUID,
    "reject_note" TEXT,
    "provider_ref" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recon_exceptions" (
    "id" UUID NOT NULL,
    "report_date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider_payment_id" TEXT NOT NULL,
    "expected_paise" INTEGER,
    "reported_paise" INTEGER,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "resolved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "recon_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "order_id" UUID,
    "refund_id" UUID,
    "payout_id" UUID,
    "reason" TEXT NOT NULL,
    "evidence_media_ids" UUID[],
    "status" TEXT NOT NULL,
    "resolution_note" TEXT,
    "adjustment_paise" INTEGER NOT NULL DEFAULT 0,
    "deadline_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "settled_in_payout" UUID,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "variant_ids" UUID[],
    "description" TEXT,
    "photo_media_ids" UUID[],
    "claimed_paise" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "trust_score" DOUBLE PRECISION NOT NULL,
    "decision" JSONB NOT NULL,
    "refund_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "rider_user_id" UUID,
    "store_stars" INTEGER NOT NULL,
    "rider_stars" INTEGER,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("order_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settlement_runs_kind_period_start_period_end_key" ON "settlement_runs"("kind", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "payouts_party_type_party_id_period_start_idx" ON "payouts"("party_type", "party_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_run_id_party_type_party_id_key" ON "payouts"("run_id", "party_type", "party_id");

-- CreateIndex
CREATE INDEX "refund_requests_status_created_at_idx" ON "refund_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "refund_requests_order_id_idx" ON "refund_requests"("order_id");

-- CreateIndex
CREATE INDEX "refund_requests_merchant_id_liability_processed_at_idx" ON "refund_requests"("merchant_id", "liability", "processed_at");

-- CreateIndex
CREATE INDEX "recon_exceptions_status_idx" ON "recon_exceptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "recon_exceptions_report_date_provider_payment_id_kind_key" ON "recon_exceptions"("report_date", "provider_payment_id", "kind");

-- CreateIndex
CREATE INDEX "disputes_merchant_id_status_idx" ON "disputes"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "disputes_status_created_at_idx" ON "disputes"("status", "created_at");

-- CreateIndex
CREATE INDEX "issues_user_id_created_at_idx" ON "issues"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "issues_merchant_id_created_at_idx" ON "issues"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "issues_order_id_idx" ON "issues"("order_id");

-- CreateIndex
CREATE INDEX "ratings_merchant_id_created_at_idx" ON "ratings"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "ratings_rider_user_id_idx" ON "ratings"("rider_user_id");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "settlement_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

