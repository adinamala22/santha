-- ADR-038: stores deliver up to 7 km at the normal delivery fee (was 5 km, ADR-022); beyond it the long distance charge applies.
ALTER TABLE "merchants" ALTER COLUMN "radius_m" SET DEFAULT 7000;
UPDATE "merchants" SET "radius_m" = 7000 WHERE "radius_m" = 5000;

-- Rider pay: the base covers the first 5 km, then Rs 5 per km. Only versions still on the old untouched default are moved.
UPDATE "micro_market_versions"
   SET "rider_pay" = jsonb_set("rider_pay", '{perKmPaise}', '500')
 WHERE ("rider_pay"->>'basePaise')::int = 3000 AND ("rider_pay"->>'perKmPaise')::int = 700;
