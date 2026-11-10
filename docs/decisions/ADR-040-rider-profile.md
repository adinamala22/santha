# ADR-040: Rider profile screen

- Status: accepted
- Date: 2026-11-10

## Context
The rider app had no place that says who the rider is on Santha. The name sat in the title, the rating and
acceptance in the home card, and the home bar held six icons (SOS, earnings, support, language, sign out).
The team asked for a rider profile.

## Decision
- A **My profile** screen (`/profile`, opened by a person icon on the home bar) shows the name with an initial
  avatar, the vehicle, the customers' rating with stars (or "No rating yet"), the acceptance rate, today's
  deliveries, earnings and online time, and links to Earnings and payouts.
- **Language** and **Sign out** move from the home bar into the profile, so the bar keeps SOS, earnings, support and
  profile. Sign out keeps its rules (offline first; refused with a delivery in hand).
- It uses the data `/v1/riders/me` already returns: no backend change. The phone number is not shown because the app
  does not keep it after login; photo and documents stay in onboarding.

## Consequences
- Tests that signed out from the home bar now open the profile first.
- A photo, phone and document status can be added to the profile later without moving anything.
