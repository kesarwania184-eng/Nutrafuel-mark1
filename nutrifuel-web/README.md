# NutriFuel

NutriFuel is a local-first meal journal with daily nutrition targets, quick meal logging, and a recipe analyzer. Logs are saved in the browser immediately. Email/password accounts add private, automatic cross-device sync and durable history through the MySQL/Drizzle backend. Existing platform OAuth sign-in remains available when configured.

## Requirements

- Node.js 20 or newer
- pnpm 10 or newer
- A MySQL-compatible database for account sign-in and durable sync

## Start locally

```sh
pnpm install
pnpm dev
```

The app listens on port 3000 by default. Set `PORT` to use a different port. Logging and recipe analysis work without a database. Email/password account features and durable cross-device sync require `DATABASE_URL`; until configured, your log stays on this device.

## Account sync setup

For local development with Docker Desktop, copy `.env.example` to `.env`, start the bundled local MySQL database, and apply the checked-in schema migrations:

```sh
cp .env.example .env
docker compose up -d db
pnpm install
pnpm db:migrate
pnpm dev
```

In PowerShell, use `Copy-Item .env.example .env` for the first command. The local database uses development-only credentials, listens only on `127.0.0.1`, and keeps its data in a Docker volume. Back up that volume if you need to preserve local account history. If you use a managed database, replace `DATABASE_URL` with its private connection string and run the migrations before starting the app.

After migrations, users can create an account or sign in from the NutriFuel header. Platform OAuth remains optional; configure `MANUS_PROJECT_ID`, `MANUS_JWT_SECRET`, `MANUS_OAUTH_API_URL`, and `MANUS_OAUTH_PORTAL_URL` only if you want that provider too. Keep all server secrets private and serve production traffic over HTTPS.

Passwords are stored as salted scrypt hashes, never as plain text. First-party sessions use random opaque tokens whose hashes are stored in the database, HttpOnly/SameSite cookies, a 30-day expiry, and server-side revocation on sign-out. Repeated attempts are rate-limited. Nutrition snapshots are scoped to the authenticated account and automatically synced after edits; offline edits remain local and are retried when connectivity returns. Users can download a JSON backup and restore it by merging it with the current history. Password reset emails are not available until an email delivery provider is configured.

The app exposes `GET /api/health` as a process liveness check. It does not indicate whether the database is configured or ready.

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
