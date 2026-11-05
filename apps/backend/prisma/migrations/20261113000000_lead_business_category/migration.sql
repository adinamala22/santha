-- ADR-023: launch landing page. Store leads carry the shop name and type; "customer" leads are launch-list sign-ups.
ALTER TABLE "leads" ADD COLUMN "business" TEXT;
ALTER TABLE "leads" ADD COLUMN "category" TEXT;
