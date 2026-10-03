# NutriFit end-to-end smoke tests

Start the full app with `pnpm dev`, then run `NUTRIFIT_E2E_BASE_URL=http://127.0.0.1:3000 pnpm test -- tests/e2e/http-smoke.test.ts` to verify the readiness route and page route manifest against a running server. The deterministic sync tests run with the normal `pnpm test` command and cover local migration, concurrent edits, and deletion tombstones without needing external credentials.
