# ADR-004: Keep consumer, merchant and rider as three separate apps
2026-11-01 · Status: accepted

## Context
We considered merging the consumer and merchant apps into one "Santha" app that shows the shopping or shop
interface based on the user's roles (as Airbnb does with "Switch to hosting"). Many Santha sellers (home kitchens,
home businesses) are also buyers, and one app means one store listing. The closest comparable marketplaces with
real merchants (Swiggy, Zomato, Uber Eats) all ship separate customer, partner and delivery apps; Zepto and Blinkit
have no third-party merchants at all.

## Decision
Keep three apps: **Santha** (consumer), **Santha Partner** (merchant, incl. staff-mode self-delivery) and
**Santha Rider**. Code is shared through `packages/santha_*`. One phone number can still hold several roles: the
access token carries all of a user's roles, so a merchant can sign in to the consumer app with the same number.

## Consequences / when to revisit
The merchant app's sensitive Android permissions (full-screen ringing order alerts, foreground service, background
location for staff mode) stay out of the consumer app's Play Store listing and install size. Merchant fixes ship
without a consumer release, and ratings stay separate. The consumer app should get a "Sell on Santha" entry that
opens or installs Santha Partner (to land with the consumer profile screen). Revisit if merchant-side permissions
stop being needed or if onboarding data shows sellers dropping off at the second install.
