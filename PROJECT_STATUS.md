# NutraFuel Project Status — Claude Handoff

## Repository

- GitHub: `kesarwania184-eng/Nutrafuel-mark1`
- Default branch: `main`
- Latest GitHub commit observed during handoff preparation: `73870d5e0cafd0e78c0f18b1d3250890528162be` — `Fix recipe parser indentation` (2026-09-27).
- Important earlier commits include `9d1a32a` (`Fix generic oil test and dependencies`) and `bc9094d` (`Fix servings parsing and generic oil ambiguity`).

## What the project is

A deterministic nutrition engine for homemade recipes. A language model may parse text into structure, but all nutrition numbers are calculated from reference data and deterministic rules.

The main API is:

- `GET /v1/health`
- `POST /v1/recipes/parse`
- `POST /v1/recipes/analyze`
- `GET /v1/ingredients/search?q=...`

Run locally with:

```powershell
uvicorn app.main:app --reload
```

Swagger is normally available at `http://127.0.0.1:8000/docs`.

## Existing architecture

```text
app/
  schemas.py
  repository.py
  services/
    parser.py
    matcher.py
    converter.py
    nutrition.py
    cooking.py
    confidence.py
    pipeline.py
  api/routes.py
  db/
  data/
    aliases.csv
    cooking_methods.csv
    household_units.csv
    ingredients.csv
```

The project uses a rules-first parser and can optionally route difficult parsing to an LLM through a provider-agnostic callable.

## Important completed fixes

### Generic oil ambiguity

Plain `oil` must not silently become `sunflower oil` or another specific oil. A generic oil should remain unresolved/confirmation-required unless the user actually specifies the type.

### Serving metadata

Inputs such as:

- `serves 4`
- `4 servings`
- `for 4 people`
- `makes 4 portions`

are recipe-level metadata and must not be parsed as ingredients.

### Dish-name headers

An input such as:

`Chicken curry: 500g chicken breast, 2 medium onions, 2 tbsp oil`

should produce `dish_name = Chicken curry`; `Chicken curry` must not become a fake ingredient.

### Cooking physics

Water loss changes cooked mass, not calories/macros. User-itemized oil must not be double-counted by an absorption rule.

### Matching

The intended order is exact -> alias -> fuzzy -> unresolved/confirmation. Curated aliases handle regional/Hindi names; fuzzy matching is not a substitute for semantic synonym data.

## Known local-development context

A prior local environment used:

```text
E:\nutrifit\files\nutrifit-recipe-engine\nutrifit-recipe-engine
```

with a Python virtual environment `.venv` and Python 3.14.7.

A previously observed local test run reached `23 passed, 2 warnings`. However, the GitHub README is older and mentions 22 tests. The new agent MUST run the actual current suite instead of trusting either number.

## Frontend/UI status

The project also has a frontend/UI workstream that was developed in a separate local folder. Historical local files included:

```text
app.js
index.html
main.py
repository.py
schemas.py
Nutrafuel UI integration guide.md
NutriFit Recipe Nutrition Engine.md
```

The backend's intended static UI layout was:

```text
app/static/index.html
app/static/styles.css
app/static/app.js
```

Do not assume the UI files are present in the current GitHub default branch. Audit the repository and the user's local working tree before claiming the UI is integrated.

## Example behavior already validated historically

A recipe beginning with:

`Chicken curry: 500g chicken breast, 2 medium onions, 2 tbsp oil`

was successfully parsed with `dish_name = Chicken curry`; chicken breast and onions were structured correctly, and `oil` remained represented as the generic oil rather than silently becoming a named oil.

## Current priority

The next agent should first audit the current repository and local working tree, run all tests, start the API, exercise the parser/analyzer, and inspect the frontend integration before implementing new features.

Do not start by adding new features. First establish a clean baseline.
