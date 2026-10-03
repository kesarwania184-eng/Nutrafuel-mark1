# NutraFuel Development Queue

This is the working queue for the replacement AI agent. Work from the top after establishing a clean baseline.

## P0 — Baseline and correctness

- [ ] Inspect current Git status and local uncommitted changes.
- [ ] Run `pytest -q` and record the actual result.
- [ ] Start FastAPI and verify `/v1/health`.
- [ ] Test `/v1/recipes/parse` with normal recipes, dish headers, serving metadata, instructions, and generic oil.
- [ ] Test `/v1/recipes/analyze` and verify nutrition output and confidence fields.
- [ ] Audit frontend/static integration and verify that browser -> parse -> analyze works end-to-end.
- [ ] Add regression tests for every newly discovered bug before fixing it where practical.

## P1 — Parser quality

- [ ] Prevent cooking instructions from becoming ingredient records.
- [ ] Handle punctuation and sentence boundaries robustly.
- [ ] Preserve generic ingredient ambiguity instead of guessing.
- [ ] Improve quantity/qualifier parsing without inventing amounts.
- [ ] Expand alias coverage from real unresolved examples.
- [ ] Test Hindi/regional ingredient names against the alias table.

## P1 — Nutrition correctness

- [ ] Audit raw-vs-cooked state conversion.
- [ ] Audit food-specific household-unit conversions.
- [ ] Audit refuse/edible-weight handling.
- [ ] Audit cooking adjustments for water loss and oil absorption.
- [ ] Ensure user-itemized oil cannot be double-counted.
- [ ] Add golden recipes with independently checked expected totals.

## P1 — API and UX

- [ ] Verify parse/analyze schemas are stable and understandable.
- [ ] Make unresolved ingredients easy for the UI to display and correct.
- [ ] Make assumptions visible instead of hiding them.
- [ ] Ensure serving overrides work and do not mutate ingredient quantities unexpectedly.

## P2 — Data and production readiness

- [ ] Replace seed nutrition values with a licensed/appropriate authoritative source before production.
- [ ] Grow the alias table using unresolved/correction logs.
- [ ] Add authentication and rate limiting before exposing any paid LLM path publicly.
- [ ] Add CI that runs the complete test suite.
- [ ] Add reproducible golden-set evaluation for parser and nutrition changes.

## P3 — Future features

- [ ] Voice input.
- [ ] Image/recipe-photo input.
- [ ] More ingredients and regional aliases.
- [ ] User correction loop and learning from confirmed mappings.

Do not work on P2/P3 while P0 correctness or an existing regression is unresolved.
