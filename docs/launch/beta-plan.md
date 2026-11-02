# Closed beta plan

**Scope.** Two weeks on staging builds in two Nellore micro-markets: Dargamitta and Magunta Layout.

| Group | Size | How they join |
|---|---|---|
| Merchants | 30: 20 kirana / general, 5 home kitchens, 5 home businesses | City ops walk-ins from `/stores` and `/home-kitchens` leads (Console → Leads) |
| Consumers | 300 | Invite list; Play internal testing track; one ₹50 welcome coupon (M4 promos) |
| Riders | 10 (two shifts, lunch and dinner peaks) | `/riders` leads; KYC in the rider app; 1-hour induction |

## Run of the beta
- **Days 1–2.** Merchants only: catalogue confirmed, staff test orders, self-delivery dry run.
- **Days 3–7.** First 100 consumers; lunch (12:00–14:30) and dinner (19:00–22:00) peaks staffed.
- **Days 8–14.** All 300 consumers. COD on in both micro-markets. WhatsApp updates on for those who opt in.

Every day at 18:00 IST the team reviews Console → Reports (funnel, fill rate, on-time, contribution), the
Crashlytics crash-free rate, open grievances, refunds pending a second approver, and the P1 list.

## Exit criteria (BUILD-PLAN M8 acceptance)
| Metric | Target | Source |
|---|---|---|
| On-time delivery | ≥ 85 % | Console → Reports, "On time" (delivered by the promised time) |
| Fill rate | ≥ 95 % | Console → Reports, "Fill rate" (lines delivered as ordered) |
| Crash-free sessions | ≥ 99.5 % | Crashlytics, all three apps |
| Open P1 defects | 0 | Issue tracker label `P1` |
| Landing Lighthouse | ≥ 90 | Launch checklist |
| Pen-test criticals | closed | Pen-test report |
| DPDP artefacts | in place | `dpdp-register.md` |

## Stop rules
Pause new orders for a micro-market on any of the conditions below. To pause, publish a micro-market config version with closed hours (Console → Micro-markets → Hours). This writes an audit row. A one-click pause is a follow-up.
- a payment or money mismatch in reconciliation that is not explained within 2 hours;
- a P1 that affects order placement;
- a rider safety incident.
