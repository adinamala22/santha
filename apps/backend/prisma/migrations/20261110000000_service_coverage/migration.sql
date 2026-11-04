-- Service coverage (ADR-019): city-wide "nearest micro-market" fallback, configured by ops.
-- AlterTable
ALTER TABLE "cities" ADD COLUMN     "coverage" JSONB NOT NULL DEFAULT '{}';
