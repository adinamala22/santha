# ADR-036: "Leave at the door"

**Status:** accepted (2026-11-09) · **Context:** ADR-030 left "a customer setting for always leaving the order at the door" as not yet done; until now the rider decided this with the customer on a call.

## Decision

- **A saved choice on each address:** "Leave my prepaid orders at the door" (`addresses.leave_at_door`, off by default), set when the address is saved in the consumer app.
- **At checkout** the same switch shows the saved choice as its default and can be changed for that one order (`leaveAtDoor` on `POST /v1/orders`). It is shown for prepaid orders only.
- **Prepaid only:** a cash order never carries the choice, whatever was saved or sent, because the rider has to collect the cash from the customer.
- **On the order:** the choice is stored in the order's address snapshot (`orders.address.leaveAtDoor`), so a later change to the saved address does not change an order already placed, and no orders migration is needed. Orders placed before this change read as "no".
- **The rider** sees a note on the job ("The customer said: leave the order at the door ... use Deliver with photo"), and is **not** shown the "waited 5 minutes: call again or report" prompt. `job.drop.leaveAtDoor` carries it.
- **Nothing else changes:** the door-photo rules of ADR-030 stay as they were (prepaid, up to ₹2,000, after "arrived at the customer", this rider's photo for this job). The choice never lets a rider skip the photo or the OTP.
- **Ops** see "Leave at the door: yes / no" on the order page, for disputes together with the door evidence of ADR-033.

## Consequences

- Migration `20261121000000_leave_at_door` (one column on `addresses`).
- No new analytics event.
- Tests: `test/fake/leave-at-door.fake.spec.ts`, the address repository contract (Prisma and in-memory), `apps/web/e2e/features/leave-at-door.spec.ts`, and the Flutter tests in the consumer (checkout switch, address form) and rider (note, no waiting prompt) apps.
