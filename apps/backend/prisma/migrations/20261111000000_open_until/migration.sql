-- ADR-021: the partner's Open switch outside the hours keeps the store open until the next scheduled close.
ALTER TABLE "merchants" ADD COLUMN "open_until" TIMESTAMPTZ(6);
