# ADR-039: The customer can rate a delivery made by the store's own staff

- Status: accepted
- Date: 2026-11-10

## Context
After a delivery the consumer app showed a "The delivery" star row only when a Santha rider had delivered. When the
store's own staff delivered (self delivery), the customer could rate only the store, although the delivery is the
part customers judge. The team asked for the self delivery to be rated too.

## Decision
- The delivery rating is offered, and accepted by `POST /v1/orders/{id}/rating`, when the order was delivered by a
  Santha rider **or** by the store's own staff. A third-party courier order is still store-only.
- The stars are kept in the existing `rider_stars` column (it now means "delivery stars"; no migration, no API change).
  The rider average (`setRiderRating`) is updated only when a rider delivered, so a self delivery never touches any rider.
- Consumer app: the row appears for `DeliveryMode.rider` and `DeliveryMode.self`, and "Your rating" shows it.

## Consequences
- Delivery stars of self deliveries are stored but not yet summarised for the merchant; a merchant-side view can follow.
- The `rating.submitted` event carries `rider_user_id: null` and `rider_stars` for self deliveries.
