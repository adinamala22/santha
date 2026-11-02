# DPDP Act 2023 register

Santha Technologies is the Data Fiduciary. Merchants receive personal data only for fulfilling an order
(Tech plan §8.4). This register lists each artefact and where it lives.

## Notices
| Artefact | Where | Version |
|---|---|---|
| Privacy notice (en/te) | `/legal/privacy` (`apps/web/src/i18n/site.ts`) | `privacy-2026-11` |
| Terms of use (en/te) | `/legal/terms` | `terms-2026-11` |
| Grievance officer and redressal (en/te) | `/legal/grievance`; in the app under Account → Privacy and help | — |
| Notice at sign-in | Consumer login screen ("By continuing you agree…") | — |

Notice versions are set in `NOTICE_VERSIONS` (`apps/backend/src/modules/trust-safety/compliance.service.ts`).
When a version is bumped, every consent becomes `current: false`, so the app records it again at the next sign-in.

## Consent records
- **Ledger.** `consents` is append-only: user, purpose, granted, notice version, timestamp, source.
  `GET/PUT /v1/me/consents` read and write it.
- **Purposes.**
  - `terms` and `privacy`: recorded after sign-in.
  - `marketing`: off by default; toggled in Privacy and help.
  - `whatsapp_updates`: the M5 toggle.
- **Withdrawal.** Withdrawing consent is as easy as giving it: the same switch.

## Data-principal rights
| Right | Flow | Service level |
|---|---|---|
| Access | App → Download my data → `POST /v1/me/data-requests {type: access}`; the JSON export is ready at once | Immediate |
| Correction | `POST /v1/me/data-requests {type: correction}`; ops completes it in Console → Privacy requests | 30 days |
| Erasure | App → Delete my account → ops completes it in Console → Privacy requests. This anonymises the account: phone, name and addresses are removed and sessions revoked. Orders and tax records keep only the id, as GST law requires. | 30 days (the app promises 7) |
| Grievance | App or `grievance@santha.in` → Console → Grievances | Acknowledge within 48 h; resolve within 30 days (IT Rules 2021) |

Every ops action on these requests writes an audit row: `grievance.acknowledged`, `grievance.resolved`,
`data_request.completed` (for an erasure, the account is anonymised in the same step), `data_request.rejected`,
`review.published` and `review.hidden`.

## Minimisation and sharing
- Phone numbers are masked between parties (Exotel).
- Exact addresses go to merchants only after acceptance and to riders only after assignment.
- The analytics export to PostHog carries ids, states and amounts only. Phone numbers, names and
  addresses never leave (`GrowthService.export`).
- The public store pages (`/s/[slug]`) show the store's name, area, rating and hours, and nothing personal.

## Retention
| Data | Kept for | Why |
|---|---|---|
| Orders, invoices, payouts, TCS/TDS | 8 years | GST and Income-tax record-keeping |
| Account (phone, name) | Until erasure, or 3 years after last use | Service |
| Addresses | Until deleted or erased | Service |
| Rider location fixes | 90 days | Disputes and safety |
| Grievances and audit events | 3 years | IT Rules; accountability |
| Access-export files | 7 days, then lifecycle rule on `privacy/exports/` | Minimisation |

## Breach
Follow the runbook in `runbooks.md` → "Personal data breach":
- notify the Data Protection Board and the affected users without delay, in the form the Rules prescribe;
- the notification templates for en and te are in the runbook.

## Processors
| Processor | Data | Region |
|---|---|---|
| AWS | All data | ap-south-1 (Mumbai) |
| Razorpay | Payments | India |
| Digio / Signzy | KYC | India |
| MSG91, Exotel, WhatsApp Business (Meta BSP) | Phone numbers, for messages | India routing |
| Firebase | FCM tokens, crash logs | Configured for minimum collection; no ads ids |
| PostHog | Ids only | EU/US cloud is not allowed; India region or self-hosted |
