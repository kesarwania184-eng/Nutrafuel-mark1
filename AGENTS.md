# NutraFuel AI Development Instructions

## Project identity

NutraFuel / NutriFit Recipe Nutrition Engine is a FastAPI application for deterministic nutrition analysis of homemade recipes, especially Indian recipes.

Repository: `kesarwania184-eng/Nutrafuel-mark1`
Default branch: `main`

## Mission

Continue the existing project. Do not rewrite the architecture just because another AI is taking over. Preserve working behavior, improve correctness incrementally, and add regression tests for every bug fixed.

The model is a parser, not a nutrition calculator. Nutrition arithmetic must remain deterministic and come from reference data and explicit conversion/cooking rules.

## Before changing code

1. Read `README.md`, `AGENTS.md`, `PROJECT_STATUS.md`, and `TODO.md`.
2. Inspect the repository structure.
3. Run the existing test suite with `pytest -q`.
4. Run the application and exercise `/v1/health`, `/v1/recipes/parse`, and `/v1/recipes/analyze` when relevant.
5. Inspect the Git diff before making further changes if the working tree is not clean.
6. Never assume an old chat transcript is authoritative; the repository and tests are the source of truth.

## Core architecture rules

- Parser: natural language -> validated structured recipe.
- Matcher: exact -> alias -> fuzzy -> unresolved/confirmation. Never silently guess when ambiguity is material.
- Converter: ingredient-specific units, density, refuse, and cooked-to-raw conversion.
- Nutrition: deterministic arithmetic from reference tables.
- Cooking: water loss changes mass, not calories/macros; avoid double-counting user-itemized oil.
- Servings: recipe-level serving metadata must not become an ingredient.
- Confidence: explain assumptions and distinguish nutrition confidence from sodium/cooked-weight confidence.
- API: preserve existing endpoint contracts unless a change is deliberate, tested, and documented.

## Parser invariants

- Generic `oil` must not silently resolve to a specific oil such as sunflower oil.
- Missing quantities must stay missing rather than being invented.
- `quantity_kind` must remain one of: `mass`, `volume`, `count`, `household`, `vague`, `missing`.
- `method` must be a supported cooking method or null.
- Recipe/dish headers such as `Chicken curry:` are dish metadata, not ingredients.
- Serving metadata such as `serves 4`, `4 servings`, `for 4 people`, or `makes 4 portions` is recipe-level metadata, not an ingredient.
- Instruction text such as `cook the onions`, `then add paneer`, etc. must not become fake ingredients.
- Preserve user-itemized oil; do not add cooking oil a second time unless the cooking model explicitly requires unitemized absorption.

## Testing policy

Every bug fix should include or update a regression test.

At minimum, run:

```powershell
pytest -q
```

For API changes, also run the FastAPI application and test the affected endpoint through its real request path.

Do not remove or weaken a test just to make the suite pass.

## Change policy

- Make the smallest correct change first.
- Prefer focused fixes over broad rewrites.
- Keep public schemas backward compatible where practical.
- Do not introduce an LLM dependency into deterministic paths.
- Do not add nutrition numbers to the parser output.
- Do not invent nutrition data when reference data is absent; surface unresolved/low-confidence state instead.
- Do not commit secrets, API keys, `.env`, `.venv`, caches, or generated local artifacts.

## Git workflow

Use a feature branch for meaningful work. Before committing:

```powershell
git status
git diff
pytest -q
```

Use clear commits, for example:

```text
Fix generic ingredient ambiguity
Add regression tests for serving metadata
Improve recipe instruction parsing
```

Never force-push or reset user work without explicit approval.

## Handoff context

This project was previously developed with Claude. The replacement agent should treat this repository, its tests, and Git history as the authoritative handoff. Historical notes are in `PROJECT_STATUS.md` and `TODO.md`.

If the current working tree contains changes not represented in GitHub, preserve them and inspect them before attempting a pull/rebase.
