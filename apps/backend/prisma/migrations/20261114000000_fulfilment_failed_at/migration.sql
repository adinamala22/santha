-- ADR-026: a courier reports a delivery they could not hand over.
ALTER TABLE "fulfilments" ADD COLUMN "failed_at" TIMESTAMPTZ(6);
