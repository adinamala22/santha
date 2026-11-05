# ADR-023: Launch landing page: "Launching soon" behind a flag, a launch list, and the shop sign-up

Status: accepted (2026-11-05)

## Context
The website showed "Get it on Android" and "iPhone — join waitlist" buttons that went nowhere: the apps are not
in the stores yet. The product owner asked for three things:
- A feature toggle for the download call to action.
- "Launching soon on Android and iPhone" until launch.
- An attractive sign-up form for shops, one that makes them feel they would miss out by not joining.

## Decision
1. **Flag `app_downloads`** (FlagsService, default **off**, so pre-launch is the safe state). The public
   `GET /v1/config/site` returns `{ appDownloads, androidUrl, iosUrl }`. The store links come from the env
   (`ANDROID_APP_URL`, `IOS_APP_URL`) and are given only when the flag is on. The website reads this endpoint
   with a 60-second cache, so ops switch downloads on in PostHog (or with `FLAG_OVERRIDES`) without a redeploy.
   If the API cannot be reached, the site stays in pre-launch mode and never shows a dead download link.
2. **Pre-launch landing.**
   - The hero shows a "Launching soon in Nellore" badge, "Coming soon on Android and iPhone" with plain
     platform tiles (not store badges, which may only be used once the app is listed), and a "Tell me when it
     launches" sign-up.
   - The sign-up is saved as a lead of the new kind `customer`, with the same honeypot and per-IP rate limit
     as the other lead forms. Ops see it in Leads as "Launch list".
   - The header call to action reads "Launching soon" and jumps to the sign-up.
   - Store link pages (`/s/…`) replace the app deep link with the launch sign-up.
   - The app is not listed as a schema.org `MobileApplication` until downloads are on.
3. **Shop sign-up (`/stores`).**
   - Before launch the page says "Your customers are about to find you on Santha". A "what you'd miss" panel
     reads: on launch day people search Santha, and the shops on it show up.
   - The form asks for the shop name and type, and shows a live preview of the card customers will see (name,
     type · area, "New on Santha", 30–45 min).
   - Leads gain `business` and `category` (migration `20261113000000_lead_business_category`). Ops see "shop ·
     type" in Leads.
   - After launch the same form stays, with the normal wording.
4. **Honest urgency only.** The copy uses facts the product already commits to: no listing fee, commission
   from 6%, paid every night, our team helps set up the catalogue before launch (BRD 10.1, assisted entry).
   There are no invented counts of shops that have joined, no limited spots and no countdown, because there
   is no confirmed launch date. Add real numbers only once they exist.

## Consequences
- **Launch day:**
  1. Set `ANDROID_APP_URL` and `IOS_APP_URL` in the env.
  2. Turn on `app_downloads` in PostHog.
  3. The whole site switches within a minute.
- **Launch-list follow-up:** customer leads are a contact list for one launch message. Ops send it; there is
  no automated sender yet.
