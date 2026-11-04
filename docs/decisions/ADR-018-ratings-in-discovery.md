# ADR-018: Store ratings reach discovery; ratings & reviews completed across the apps

- Status: accepted
- Date: 2026-11-04

## Context
Ratings were stored since M7 (one per delivered order: store stars, rider stars when a rider delivered, an
optional comment) and moderated since M8, but the search index wrote `rating: null` for every store. So store
cards and store pages always said "New on Santha", ranking used the neutral default, and the PRD's discovery
filter "rating ≥4" and the store page "rating distribution" could not exist. The consumer app also could not tell
whether an order was already rated, and could not send a comment.

## Decision
- **Events.** `rating.submitted` and `rating.moderated` (payload carries `merchant_id`) are written in the same
  transaction as the rating row (`IssuesRepository.addRating/updateRating(…, events)`; in fake mode through
  `FakeSinks`). The search indexer consumes both and rebuilds that store.
- **Where search gets ratings.** Ratings belong to trust-safety, and trust-safety already imports
  search-discovery, so search-discovery cannot import trust-safety. search-discovery exposes a small
  `StoreRatings` registry; `IssuesService.onModuleInit` registers `IssuesRepository.storeSummary` as its source.
  Without a source, or if it throws, stores show as unrated: search keeps working. The number on cards is the
  average of store stars of reviews that are not hidden, rounded to one decimal place. Flagged reviews still count (stars
  are not the problem, the comment is). We do not copy the average onto `merchants`: there is one source of truth
  and no migration.
- **API.** `minRating` on `/feed` and `/search` (unrated stores are left out); public
  `GET /stores/{id}/reviews` (summary `{avg, count, distribution[1..5]}` + newest published reviews with a
  comment, `limit` ≤ 50); `GET /orders/{id}/rating` (yours, or `null`); `/merchants/me/reviews` and
  `/public/stores/{slug}` gain the same `summary` / `distribution`.
- **Apps.** Consumer: "★ 4.0+" chip next to the store list title (full wording as tooltip/semantics), store page
  "Ratings & reviews" section and sheet with the breakdown and store replies, rating card with an optional
  review (screened server-side) and a "Your rating" state once rated. Merchant: store rating with breakdown and a
  coaching tip below 4★. Rider: own rating on the home "today" card. Web `/s/{slug}`: rating bars. Shared
  `StarRow` / `RatingBreakdown` widgets live in santha_ui.

## Consequences
- Each store reindex runs one extra aggregate query (`groupBy` on `ratings`, indexed by `merchant_id`).
- Demo data: there are no seeded orders, so stores start unrated in fake mode; ratings appear as orders are
  delivered and rated (`test/fake/m8-ratings.fake.spec.ts` walks through it).
- Item-level ratings are not part of this (not in the PRD P0 list).
