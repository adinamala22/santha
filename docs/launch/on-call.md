# On-call

## Hours
- **Engineering on-call:** 08:00–23:00 IST every day during the beta, and 24 × 7 from public launch.
- **City ops and support:** 09:00–22:30 IST, which covers the lunch (12:00–14:30) and dinner (19:00–22:00) peaks.

## Rota (beta weeks; fill in the names)
| Week | Primary (backend) | Secondary (mobile / web) | City ops lead | Finance (payouts, recon) |
|---|---|---|---|---|
| Beta week 1 | | | | |
| Beta week 2 | | | | |

- Each shift hands over at 09:00 IST in the incident channel, covering:
  - open incidents;
  - flags changed;
  - payouts on hold.
- The primary carries the pager (Grafana OnCall). The secondary is the backup after 10 minutes.

## Severities
| Severity | Examples | Response | Update cadence |
|---|---|---|---|
| P1 | Orders cannot be placed; payments failing; merchant alerts down; data breach; a money error affecting payouts | 15 min, around the clock | Every 30 min |
| P2 | One micro-market degraded; dispatch slow; search down (orders still work) | 30 min in hours | Every 2 h |
| P3 | A single store or user problem; a cosmetic bug | Next working day | — |

## Escalation
1. Primary.
2. Secondary, after 10 minutes.
3. Engineering lead.
4. Founders, for a P1 lasting over 1 hour or any breach.

Legal and the grievance officer are told of every breach and every regulator contact.

## Tools
- Grafana: SLO board and alerts
- Sentry and Crashlytics: errors and crashes
- PostHog: funnel and flags
- Console `/admin`: live orders, payouts, refunds, grievances
- AWS console (read-only role for the secondary)
- Runbooks: `runbooks.md`
