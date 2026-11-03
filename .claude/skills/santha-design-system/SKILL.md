---
name: santha-design-system
description: Santha brand and UI rules — colour tokens (Santha Indigo, Market Marigold, cream, slate, leaf, chilli), Poppins and Noto Sans Telugu type, spacing and radius, component patterns (ETA chip, self-delivers badge, veg/non-veg marks, store card, order card, bottom sheets), logo usage and app icons. Use whenever building or styling any screen, page, component, email, or asset for the consumer, merchant, rider apps, the landing site, or the admin console, and whenever choosing a colour, font, icon, or logo file.
---

# Santha design system

Source of truth: `design/tokens/tokens.json`. Consume it through the generated files — never type a hex value in app code.
- Flutter: `packages/santha_ui/lib/src/tokens.dart` (copy of `design/tokens/santha_tokens.dart`) and `santhaTheme()`.
- Web: `design/tokens/tokens.css` (CSS variables) and `design/tokens/tailwind.tokens.js` spread into `theme.extend`.

## Colours (what each is for)
- **Santha Indigo #1F2A5C** — primary: app bars, primary buttons, nav, pin body, headlines. Indigo 700 pressed, Indigo 300 muted text on dark, Indigo 100 borders/tints.
- **Market Marigold #F5A623** — accent: awning stripes, promo cards, accent CTA ("Download the app", "Accept" countdown ring), active tab on indigo. Marigold 600 pressed, Marigold 100 highlight backgrounds and the "Self-delivers" badge.
- **Cream #FFF8EC** — warm surfaces (how-it-works cards, shop facade in the logo). **Sky #EAF0FF** — cool app background tint and category tiles.
- **Ink #1A1D29** primary text; **Slate #5B6478** secondary text and captions.
- **Leaf #2E9E6B** success, delivered, ETA chip text, veg mark. **Chilli #D9453D** errors, SLA breach, non-veg mark. These two are functional only — never decorative.
- Contrast: body text on white uses Ink or Slate (AA); white text only on Indigo/Indigo 700/Leaf/Chilli; Indigo text on Marigold (AA for ≥14 px medium).

## Type
- Poppins Bold for display/h1/h2 and the wordmark; Poppins Medium for labels, buttons, chips; Poppins Regular for body.
- Telugu UI text uses Noto Sans Telugu at the same scale (slightly larger line height). Bundle both fonts in the apps; load from Google Fonts on web with `font-display: swap`.
- Scale: display 32/38 · h1 24/30 · h2 20/26 · h3 16/22 · body 14/20 · caption 12/16 · micro 10/14.

## Layout
- 4-pt grid; screen padding 24 (phones), 16 inside cards; card radius 16, inputs pill (999), buttons 14–16, chips pill.
- Bottom tab bar (consumer: Home · Search · Orders · Account; merchant: Orders · Catalogue · Earnings · More). Active = indigo filled circle icon + indigo label.
- Indigo header block with white text on Home and merchant Orders; content on white below (see `design/mockups/consumer-home-hifi.png`, `merchant-orders-hifi.png`).

## Components (build once in santha_ui / web ui, reuse everywhere)
- **StoreCard**: image 60×60 radius 10 · name (h3) · meta line (category · distance · ★ rating) · ETA chip (Leaf text on #E3F4EB) · optional "Self-delivers" badge (Indigo on Marigold 100).
- **EtaChip**, **SelfDeliversBadge**, **FssaiBadge** (Leaf), **VegMark/NonVegMark** (12 px square outline with dot/triangle), **SlotChip** (selected = Indigo).
- **ProductTile**: image · name (caption medium) · price (bold) · MRP strike (slate) · ADD pill (Indigo).
- **NewOrderCard** (merchant): Marigold 100 background, 6 px Marigold left bar, countdown on the Accept button.
- **FulfilmentChoice**: two large option cards; selected = Indigo fill with white text and the economics line.
- **StickyCartBar**: Indigo, 50 px, radius 14, "n items · ₹total" left, "View cart ›" right.
- **Toasts/Sheets**: white, radius 24 top, shadow `sheet`.
- Icons: use `design/brand/icons/` (stroke 6 at 96 px grid → export at 24 px); Material icons allowed for generic actions.

## Logo and app icon
- Files: `design/brand/logo/santha-primary.svg` (on light), `santha-primary-reverse.svg` (on indigo), `santha-mark.svg` (mark only), `santha-mono-*.svg`. App icons in `design/brand/app-icon/` (indigo default). Favicon `santha-favicon.svg`.
- Clear space = height of the pin head; minimum lockup width 120 px, mark 24 px. Never recolour, stretch, rotate, add shadows/gradients, or set "Santha" in another typeface. Don't separate సంత from the wordmark except when using the mark alone.
- Android adaptive icon: foreground = mark on transparent, background = Indigo. Notification icon: `santha-notification-icon.svg` (white silhouette).
- App names and icons:

  | App | Name | Icon |
  |---|---|---|
  | `apps/consumer` | **Santha** | `santha-app-icon.svg` (indigo) |
  | `apps/merchant` | **Santha Partner** | `santha-app-icon-marigold.svg` |
  | `apps/rider` | **Santha Rider** | `santha-app-icon-light.svg` |

  - The adaptive background is the variant's own colour.
  - Generate every launcher icon (Android legacy and adaptive, iOS) with `node scripts/app-icons.mjs`. Never hand-edit the PNGs.
  - Dev and stg builds append "Dev" / "Stg" to the Android label.

## Voice
Plain, warm, specific. English + Telugu in every string. Use local words where natural (kirana, tiffin, santha). Never promise "10 minutes"; show the computed ETA range.

## Checklist before marking UI done
Tokens only · en + te strings · 44 px touch targets · text scales to 130% · loading/empty/error states · screen matches the mockup or wireframe · logo rules respected.
