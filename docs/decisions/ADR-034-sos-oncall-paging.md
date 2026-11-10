# ADR-034: SOS pages the on-call phones

**Status:** accepted (2026-11-09) · **Context:** ADR-031 left "paging an on-call phone when an SOS arrives" as not yet done. Until now ops had to have the console open to notice an SOS.

## Decision

- **Setting:** `OPS_ALERT_PHONES`, a comma-separated list with country codes (`+919876543210,+919876543211`). It is set in the server's `.env`, not in a values file, because these are people's private numbers and the repository is public. Empty means nobody is paged. A malformed list stops the server at start.
- **What happens on SOS:**
  - the alert is created and the rider gets the answer first;
  - then every on-call phone gets an **SMS and an automated voice call** with the rider's name, the rider's phone, the order code if there is one, and a map link;
  - the page is sent in the background, so slow SMS or call providers never delay the rider;
  - a failed page never fails the SOS, and every message is in the comms log.
- **Reminder:** if the SOS is still open after `OPS_SOS_REPAGE_SEC` (default 180, 0 turns it off), the same phones are paged once more with the minutes elapsed. Resolving the SOS cancels the reminder. Pressing SOS again returns the open alert and pages nobody twice.
- **Language:** `OPS_ALERT_LOCALE` (`en` default, or `te`). Both versions of the texts exist.
- **Ops see the result:** the SOS panel on the rider page shows "Paged 2 of 2 on-call phones … at 14:05", or "No on-call phone is set" when the list is empty, so a missing setup is visible on the first alert and not found out during an emergency.

## Consequences

- Migration `20261120000000_sos_paging` (`paged_count`, `paged_at` on `rider_sos`).
- Real delivery needs the live SMS and call providers (MSG91 and Exotel). Both are still the recording mock today, so on QA the page is only logged until those accounts exist. Setting the phones now is safe.
- Tests: `test/fake/sos-paging.fake.spec.ts`, `src/config/env.spec.ts`, and `apps/web/e2e/features/rider-sos.spec.ts`.
