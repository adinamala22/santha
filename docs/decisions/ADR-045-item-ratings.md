# ADR-045: Customers can rate the items of a delivered order

- Status: accepted
- Date: 2026-11-20

## Context
After a delivery the consumer app let the customer rate the store, the delivery and add a comment. Customers also
want to say which items were good: the same store sells a great atta and a mediocre rice. The product owner asked
for a star rating on items too.

## Decision
- **One rating moment.** Item stars are given together with the order rating, in the same request
  (`POST /v1/orders/{id}/rating` takes an optional `itemStars: [{ itemId, stars }]`). The order can be rated once, so item
  stars cannot be added later. The store stars stay required; item stars are optional and any subset of the items can be rated.
- **Which items.** Only items the customer received: kept lines, and the substitute when the store swapped an item. Removed
  lines cannot be rated. Each item once; stars are whole numbers 1 to 5. Anything else is `400 VALIDATION_FAILED` and nothing is saved.
- **Storage.** New table `item_ratings (order_id, item_id, merchant_id, user_id, stars, created_at)`, primary key
  `(order_id, item_id)`, written in the same transaction as the order rating. Ratings are by catalogue item, so they
  carry across orders. No comment per item (the order comment stays the only free text, so moderation is unchanged).
- **Read.** `GET /v1/orders/{id}/rating` returns `itemStars` for the customer's own rating. The store page
  (`GET /v1/stores/{id}`) returns `rating` (average, one decimal, or null) and `ratingCount` for every item. Feed and search
  cards are unchanged. Search-discovery reads item ratings through `ItemRatings`, registered by trust-safety at
  start-up, like `StoreRatings`, so the module graph stays acyclic and a failure shows items as unrated.
- **Merchant app.** The store owner sees each item's stars and count in the catalogue, and Earnings lists the rated items with
  the lowest average first ("What customers say about your items"). `GET /v1/merchants/me/reviews` gains `itemRatings`
  (item id, average, count). No new endpoint, no per-item comments.
- **Consumer app.** The after-delivery screen lists the received items under the store stars, each with five stars;
  "Your rating" shows them afterwards; item tiles and the item sheet show the average and count.

## Consequences
- Item stars are not moderated (no text) and are not hidden when ops hides the order's review; if abuse appears, add a
  moderation flag per rating.
- The rider app is unchanged. Ops does not see item ratings yet; add it from the same table if needed.
- Event `rating.submitted` gains `item_ratings` (the number of items rated). The search index does not use it.
