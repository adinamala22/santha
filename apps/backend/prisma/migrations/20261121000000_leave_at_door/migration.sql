-- Leave at the door preference on saved addresses (ADR-036).
ALTER TABLE "addresses" ADD COLUMN "leave_at_door" BOOLEAN NOT NULL DEFAULT false;
