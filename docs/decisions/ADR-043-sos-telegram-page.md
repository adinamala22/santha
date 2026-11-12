# ADR-043: A rider SOS also pages an ops Telegram group

- Status: accepted
- Date: 2026-11-12

## Context
ADR-034 pages the on-call phones by SMS and an automated call. Neither provider exists yet (MSG91 and Exotel are
mocks) and the soft launch has no SMS. An SOS that reaches nobody is the worst failure the product can have.

## Decision
- `OPS_ALERT_TELEGRAM_BOT_TOKEN` and `OPS_ALERT_TELEGRAM_CHAT_ID` (secrets, server `.env` only) name a Telegram group.
  When set, `pageOnCall` posts the same text (rider, phone, map link) to it first, then pages phones as before.
  The repage timer sends it again while the SOS is open.
- The group counts as one place in "paged N, reached M" on the console. A Telegram failure is logged and never stops the SOS.
- Everyone in the group is notified on their phone at once; add the whole ops team and the owner.

## Consequences
- Free and live today; no DLT or telephony contract needed. Telegram is a third party that sees the page text
  (rider name and phone, a map link); the group must hold only trusted ops staff.
- SMS and voice still pay off later when a provider exists; nothing here removes them.
