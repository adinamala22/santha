# ADR-021: Every store of the city is listed; delivery follows the store radius; the Open switch overrides the hours

Status: accepted (2026-11-05). Point 2 is amended by ADR-022: beyond the radius a store still delivers, at an extra charge, instead of "Delivery not available".

## Context
On test, a store was visible only to customers inside its own micro-market, whatever its delivery radius.
For example, Rajasthan Chat Bandi (Dargamitta, 10 km radius) was open but hidden from a Magunta Layout
customer 3 km away. Checkout enforced the same rule (`NOT_DELIVERABLE` unless the address and the store were
in the same area). A partner who turned on the Open switch after their closing time also stayed "Closed" for
customers: the switch only paused and resumed orders, and only the hours decided "open". Hours could be
edited in the partner app only during onboarding, and not at all in the ops console.

## Decision (the product owner's choices)
1. **Listing.** The home feed and search span every micro-market of the customer's city (Nellore). Each store
   card carries `deliverable` (the customer is within the store's radius). Stores that cannot deliver stay
   listed, greyed with "Delivery not available to your address", with no ETA or self-delivery badge and no
   ADD button. They come after every store that can deliver. Area borders no longer limit what a customer sees.
2. **Delivery.** Serviceability is unchanged: the address must be in a served area, or within the city-wide
   fallback (ADR-019). Delivery follows the store's radius: checkout drops the same-area rule, and the store
   page no longer returns `other_area` (the value stays in the contract for older apps). Fees, dispatch and
   rider zones still use the store's own micro-market. The order is picked up there.
3. **Open switch.** Turning Open on outside the hours sets `merchants.open_until` to the next scheduled close
   (the end of the next opening period, so the store stays open straight through), or to local midnight if
   the store has no hours. Customers see it open until then. Off pauses it whatever the hours say. Saving new
   hours, by the partner or by ops, clears `open_until`. `GET /merchants/me` returns `openNow
   {open, closesAt, nextOpenAt}`. The partner app shows "Closed by your hours" with **Open now** and
   **Edit hours**, and "Open outside your hours until …".
4. **Hours.** Partners edit hours after go-live under More → Store hours. Ops edit them per day in the
   console with a reason: `PUT /v1/ops/merchants/:id/hours` (admin/ops), audit action `hours_changed`, event
   `merchant.updated` [hours].

## Consequences
- Search and the feed read every area of the city: `SearchIndex` takes a list of micro-market ids
  (Typesense `microMarketId:=[…]`).
- The feed is longer, so a pagination or "nearby first" section may be needed when a city has hundreds of stores.
- Ranking weights and ETA settings come from the customer's micro-market version, as before.
