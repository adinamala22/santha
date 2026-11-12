# One-week soft launch plan (12 to 18 November 2026)

**Goal:** soft launch in Nellore on 18 November: real customers, about 30 merchants and 10 riders onboarded by ops,
cash on delivery plus Razorpay online payment, WhatsApp OTP login, Firebase push, ops watching every order.

**Decisions (product owner, 12 Nov):** soft launch, not a public marketing launch; production stays on the AWS EC2 +
Docker server (`/opt/santha-prod`, ADR-024); Razorpay live, WhatsApp OTP (Meta) and Firebase push are live at launch;
apps ship through the Play Store internal/closed track plus a signed APK link (iOS later).

## Gate: what must be true to go live
1. `main` green; QA on the same build; the live e2e suite and an emulator walkthrough pass.
2. `LAUNCH_STAGE=live` boots on prod with real secrets (the backend refuses to start if any production check fails).
3. Backups run daily and a restore has been rehearsed; rollback rehearsed; alerts reach a phone.
4. Real OTP login, a real Rs 1 online payment with refund, a real push and a COD order all work on prod.
5. Signed release apps (prod flavor) installed on real phones by a merchant and a rider.
6. Ops can onboard a merchant and a rider, take an order end to end, and handle a problem, from the console alone.
7. Legal pages live; grievance mailbox watched; support macros ready.

## Day by day
| Day | Date | Engineering | Needs from the owner |
|---|---|---|---|
| 1 | Thu 12 | Merge #42 to #44. Plan. Production-readiness audit of `LAUNCH_STAGE=live`. Backups, restore drill, uptime alerts, Typesense auto-heal. Fix the ops-console sign-in e2e on QA. | Merge PRs. Start Razorpay KYC, Meta WhatsApp business, Firebase project today: they take days. |
| 2 | Fri 13 | Provider wiring: Razorpay live and webhook, WhatsApp templates, FCM. Release signing for the 3 apps. Secrets checklist for prod. | Keys and approvals as they arrive (values go to the server `.env`, never to the repo or chat). |
| 3 | Sat 14 | Product gaps from the question list (below). Fix every launch-blocking bug from QA. Dependency vulnerabilities. | Answers to product questions. |
| 4 | Sun 15 | Full regression on QA with real-device APKs. k6 load run. Cold start check. | Test on phones, report bugs. |
| 5 | Mon 16 | Bug fixes. Prod config flip to `live` on a staging copy first. Play Store internal track upload. | Play Console account and listing review. |
| 6 | Tue 17 | Deploy to prod. Real Rs 1 payment, real OTP, real push. Rollback rehearsal. Onboard the first merchants and riders. | Merchant list, bank details for payouts. |
| 7 | Wed 18 | Go live. Ops watching, hot-fix window. | Be on call with me. |

## Risks to watch
- Razorpay live activation, Meta template approval and Play review are outside our control and take days. Start now.
  Fallback: COD only; SMS or WhatsApp-less login is not possible (an OTP channel is required).
- One server runs QA and prod. A backup and a quick restore matter more than anything else on this list.
- Public repository: move it back to private after testing (it holds no secrets, but the code is open).

## Status
Updated by Claude as work lands; see the pull requests.
