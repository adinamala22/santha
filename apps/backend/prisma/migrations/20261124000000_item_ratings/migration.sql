-- ADR-045: customers can rate the items of a delivered order (1 to 5 stars), together with the order rating.
CREATE TABLE "item_ratings" (
    "order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_ratings_pkey" PRIMARY KEY ("order_id","item_id"),
    CONSTRAINT "item_ratings_stars_check" CHECK ("stars" BETWEEN 1 AND 5)
);

CREATE INDEX "item_ratings_merchant_id_item_id_idx" ON "item_ratings"("merchant_id", "item_id");
