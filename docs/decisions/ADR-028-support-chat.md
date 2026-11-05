# ADR-028: Support chat

Status: accepted (2026-11-05)

## Context
The PRD's MVP scope includes "support chat" after an order, "support" in the rider app, and "chat with templated messages". The 2026-11-05 review found none of it built (G2). Customers could only file a formal grievance, or report a problem after delivery. Stores and riders had no way to reach Santha at all.

## Decision
- **One conversation, optionally about one order:**
  - Customers, stores and riders start a chat from the app: the consumer's Account and order page, the partner's More tab, the rider's home and job screen.
  - They pick a topic from their app's list (`SUPPORT_TOPICS`) and write the first message.
  - A chat about an order must be the requester's order: their own (customer), their store's (partner), or one they deliver (rider).
  - There is **one open chat per order**: asking again about the same order continues it.
- **Statuses:** `waiting_support` (the requester wrote last) → `waiting_customer` (support replied) → `resolved`.
  - Writing to a resolved chat within 7 days reopens it; after that the requester starts a new one.
- **Limits:**
  - At most 3 open chats per person.
  - At most 10 messages per chat in 10 minutes.
  - Messages are 1–1000 characters, text only. Photos come later, with the media pipeline's support purpose.
- **Privacy:**
  - Phone numbers are never shown to the other side.
  - Ops see the requester's **masked** phone and name, and the linked order.
  - Audit rows (`support.replied`, `support.assigned`, `support.resolved`) record the change, never the message text.
- **Notifications:**
  - A support reply sends `support.reply`: push, or SMS when the app has no token. The data `{kind: support, threadId}` lets the app open the chat.
  - It also sends a realtime `support.message` to the requester; open chats also poll every 15 s.
  - The ops inbox refreshes every 20 s.
- **Ops console** (`/admin/support`, roles admin, ops and support):
  - The inbox with filters: waiting for us, waiting for them, resolved, mine.
  - Each chat shows the conversation, the order link, ready replies (macros, en and te) that can be edited before sending, **Assign to me** and **Resolve**.
- **Shared app code:** the chat screens live in `santha_core` (`SupportInboxPage`, `SupportChatPage`, `startSupportChat`). Each app supplies its en/te copy (`SupportStrings`) and topic list.
- **Grievances stay separate.** They are the legal channel under the E-Commerce Rules 2020, with fixed acknowledgement and resolution clocks.

## Consequences
- New tables `support_threads` and `support_messages` (migration `20261115000000_support_chat`), with Prisma and in-memory implementations.
- Opening the chat from a tapped `support` notification arrives together with push (ADR-027), once both are merged.
- No message search or SLA reports yet. Ops work from the inbox order: the oldest waiting for us is at the bottom.
