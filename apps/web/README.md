# web

Next.js 15 (App Router) — landing site and ops console. Conventions: `.claude/skills/santha-web/SKILL.md`.

- `/` — placeholder landing (hero, how it works, footer) in English + Telugu. Full site in M8.
- `/admin/login` — ops sign-in UI matching `design/mockups/admin-login-desktop.png` (email + password → OTP step).
  Backend ops auth arrives in M1; until then the form reports that sign-in is not available.
- `/admin` — redirects to sign-in until the console exists.

Design tokens come from `design/tokens/` only: Tailwind spreads `tailwind.tokens.js`; `scripts/sync-brand.mjs` copies
`tokens.css` and logos into the app before dev/build/test (outputs are git-ignored). Hex colours in code fail lint.
Copy lives in `src/i18n/messages.ts` (en + te; a test enforces parity).

```bash
pnpm --filter web dev        # http://localhost:3000
pnpm --filter web test       # Vitest + Testing Library
pnpm --filter web build      # NEXT_STANDALONE=1 for the container image (ADR-002)
```
