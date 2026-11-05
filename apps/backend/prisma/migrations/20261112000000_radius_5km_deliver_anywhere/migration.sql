-- ADR-022: every store delivers up to 5 km by default (existing stores reset to 5 km, product decision 2026-11-05);
-- beyond it, in the same city, with an extra delivery charge. "Deliver anywhere": the store delivers itself city-wide.
ALTER TABLE "merchants" ALTER COLUMN "radius_m" SET DEFAULT 5000;
UPDATE "merchants" SET "radius_m" = 5000;
ALTER TABLE "merchants" ADD COLUMN "delivers_anywhere" BOOLEAN NOT NULL DEFAULT false;
