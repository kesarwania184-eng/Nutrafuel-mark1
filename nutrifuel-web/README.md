# NutriFuel

NutriFuel is a local-first meal journal with daily nutrition targets, quick meal logging, and a recipe analyzer. Logs are saved in the browser immediately. Optional account sign-in enables private, cross-device sync through the included OAuth and MySQL/Drizzle backend.

## Requirements

- Node.js 20 or newer
- pnpm 10 or newer
- A MySQL-compatible database and the platform OAuth configuration for account sync

## Start locally

```sh
pnpm install
pnpm dev
```

The app listens on port 3000 by default. Set `PORT` to use a different port. Logging and recipe analysis work without OAuth or a database; those are required only for sign-in and durable cross-device sync.

## Account sync setup

Copy `.env.example` to `.env` and configure `DATABASE_URL`, `MANUS_PROJECT_ID`, `MANUS_JWT_SECRET`, `MANUS_OAUTH_API_URL`, and `MANUS_OAUTH_PORTAL_URL` with the values from your platform. Keep secrets private. Then apply the checked-in schema migrations:

```sh
pnpm db:migrate
```

The app exposes `GET /api/health` as a process liveness check. Nutrition snapshots are private to the authenticated account. Offline edits stay in the browser and can be retried with **Sync** when the account and network are available.

## Production

```sh
pnpm check
pnpm test
pnpm build
pnpm start
```

The test command includes recipe parsing, sync merge, authentication, and API smoke tests. To run the live-server smoke test, start the production app separately and set `NUTRIFIT_E2E_BASE_URL` to its base URL before `pnpm test`.

## Nutrition estimates

Recipe nutrition uses a small built-in reference set and approximate household-unit conversions. Values for unknown ingredients are excluded from the displayed known-food subtotal. Generic ingredients such as “oil” require a specific type before the recipe can be logged. Check serving sizes and values against product labels when accuracy matters.
