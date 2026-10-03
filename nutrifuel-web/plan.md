# NutriFit production upgrade plan

## Product intent

NutriFit stays fast and useful without a network connection, while authenticated users can safely carry their nutrition log across browsers and devices. The managed MySQL-compatible database is the durable source of truth for authenticated accounts; the browser keeps a local snapshot for responsiveness and offline work.

## Implementation decisions

- **Authentication:** Keep the starter's Manus OAuth flow and `webdev_app_session` cookie. It already validates the project-bound JWT, supports Preview auto-login, and uses `SameSite=None; Secure` for the embedded HTTPS Preview.
- **Persistence:** Add one private `user_nutrition_data` row per authenticated user. The row stores a versioned JSON snapshot, revision number, and timestamps. This is additive to the supplied `users` migration and survives process restarts and container replacement through the managed database.
- **Synchronization:** The client pulls once after authentication, merges local and server snapshots, and pushes through protected tRPC procedures. Server merges are deterministic: entries are keyed by stable IDs, the newest `updatedAt` wins, and equal timestamps use a stable JSON tie-breaker. Tombstones preserve deletions across devices. Goals use the same last-write-wins rule.
- **Local-first migration:** Local state is saved under a versioned NutriFit key. The loader also recognizes common MVP keys (`nutrifit:entries`, `nutrifit:daily-log`, `nutrifit-goals`) and normalizes them into the new snapshot without deleting the old data until the first authenticated sync succeeds.
- **Error states:** The UI exposes loading, empty, local-only, syncing, synced, conflict-resolved, offline/error, and retry states. Local edits remain usable when the network is unavailable.
- **Testing:** Add deterministic sync-engine tests, auth-cookie tests, schema/router validation coverage, and a Playwright-ready HTTP smoke test script that exercises health and route-manifest endpoints against a running server.

## Design system

- **Design movement:** warm editorial wellness dashboard—more field journal than clinical SaaS.
- **Core principles:** calm focus, visible progress, generous breathing room, and trustworthy status feedback.
- **Color philosophy:** oat and paper neutrals make daily logging feel approachable; deep ink provides clarity; a signature fennel green signals nourishment and sync health; coral is reserved for energy and emphasis.
- **Layout paradigm:** asymmetric two-column journal: a narrow orientation rail and a broad daily canvas, collapsing into a stacked mobile flow rather than a centered card grid.
- **Signature elements:** a rounded fennel-green progress ring, paper-textured panels with soft ruled dividers, and small uppercase “field note” labels for metadata.
- **Interaction philosophy:** every action gives immediate local feedback first, then a compact sync status update. Empty states invite one small next step rather than presenting a dead end.
- **Animation:** quick 160–220ms ease-out fades and upward reveals; no looping motion except the syncing spinner; progress changes use a restrained 400ms sweep.
- **Typography:** Fraunces for expressive display numbers/headlines and DM Sans for controls, labels, and data. Fall back to Georgia and system sans stacks if font loading is unavailable.
- **Brand essence:** a gentle daily nutrition companion for people who want consistency without obsession; grounded, encouraging, transparent.
- **Brand voice:** plainspoken and specific. Example lines: “A good day is built one meal at a time.” / “Your log is safe here—and still useful offline.”
- **Wordmark & logo:** a compact leaf-and-check mark beside the `nutrifit` wordmark, with the check forming the central vein of the leaf.
- **Signature brand color:** fennel green `#2F6B55`.

## Project structure

- `client/src/pages/Home.tsx` — authenticated dashboard, local-first editor, sync status, and login gate.
- `client/src/lib/localStore.ts` — versioned browser persistence and MVP migration adapter.
- `shared/nutrition.ts` — shared snapshot types, defaults, normalization, and deterministic merge logic.
- `server/nutrition.ts` — managed-database read/write helpers and conflict-aware persistence.
- `server/routers.ts` — protected `nutrition.pull` / `nutrition.push` procedures.
- `drizzle/schema.ts` and `drizzle/0001_*.sql` — durable per-user snapshot schema and additive migration.
- `tests/e2e/` — server smoke checks suitable for CI against a running application.
- `client/public/manus-routes.json` — complete page route manifest for `/` and `/404`.

## Serving and deployment

The supplied Express/Vite server remains the development and production entrypoint. `/api/health` stays unauthenticated for readiness. The Dockerfile installs from the pinned lockfile and builds the React client plus server bundle. Database migrations are committed and run explicitly with `pnpm db:migrate`; runtime data is never written to the ephemeral container filesystem.
