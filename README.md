# NutriFit Recipe Nutrition Engine

Deterministic nutrition for homemade Indian recipes. The language model parses
text into structure. Every number is computed from reference tables.

```
POST /v1/recipes/parse    text -> structure + match candidates (no numbers yet)
POST /v1/recipes/analyze  structure -> nutrition, per serving, confidence
GET  /v1/ingredients/search?q=pyaz
GET  /v1/health
```

---

## Part 1 — What was wrong with the original plan

### Blockers

**1. The dataset cannot do the job.** The 1,014-item catalogue is dish-level:
finished foods with per-100g and per-serving values. Recipe decomposition needs
ingredient-level composition (raw chicken breast, raw onion, sunflower oil). You
cannot derive "500 g chicken + 2 onions" from a table of finished curries, and if
the matcher resolves the word "chicken" to a row for *Chicken Curry*, the answer
is several times too large with no way to notice. This build ships a separate
89-row raw-ingredient table and keeps `dishes` and `ingredients` as two tables
with two code paths.

**2. The spec's own worked example is off by the raw/cooked bug.** It shows 500 g
chicken producing 164 g protein. That is 32.8 g per 100 g, which is the value for
*cooked* chicken breast. Raw is 22.5 g per 100 g, so the correct figure is about
113 g. Applying cooked-state values to raw weights inflates grains and pulses by
roughly 2.5x and meat by about 1.4x. Every ingredient row now carries a `state`
column and a `cooked_yield`, and a "1 cup cooked rice" entry is converted back to
its raw equivalent before the arithmetic.

### Physics errors

**3. Water loss does not change calories.** The spec's cooking table had a "water
loss %" column feeding an engine that "modifies final values". Evaporating water
removes mass, not energy. Macros are conserved under every domestic method.
Moisture only affects cooked weight and per-100g density. Corrected: moisture
never touches macros, and it is used solely to estimate cooked weight.

**4. Oil gain double-counts.** If the user itemised 2 tbsp of oil and the cooking
engine then adds `oil_gain` per 100 g on top, that oil is counted twice.
Absorption is only real when the frying bath is *not* itemised. Corrected: in a
deep fry, absorbed oil is estimated and the remainder of any itemised oil is
*subtracted*, because it stays in the kadhai.

**5. "Vitamin loss %" has no destination.** The schema tracks six nutrients, none
of them vitamins. That column can only ever be dead weight. Replaced with a
leaching model that reduces water-soluble minerals (sodium today, potassium and
B-vitamins when those columns exist) when the cooking liquid is discarded.

### Matching and units

**6. Fuzzy matching cannot solve synonyms.** The spec's own example is
`Shimla Mirch -> Bell Pepper`. Their token-set ratio is under 30, so a 90%
threshold will never fire. RapidFuzz fixes typos and word order; a curated alias
table is what handles Hindi and regional names. Corrected order: exact →
alias → fuzzy → ask the user. There is a test asserting the fuzzy score is
hopeless here, so nobody re-introduces the assumption later.

**7. A global `unit -> grams` table is wrong by up to 15x.** One cup is 185 g of
raw rice, 245 g of milk, 120 g of atta and 16 g of coriander leaves. Corrected:
lookup on `(unit, ingredient)`, then `(unit, category)`, then generic, with the
generic case flagged as low confidence.

**8. Gross weight is not edible weight.** Two medium onions weigh 220 g on the
scale and about 198 g in the pan. Bone-in chicken is 28% refuse. Added a
`refuse_pct` column applied before the nutrition step.

### Product and operational gaps

**9. One fire-and-forget endpoint gives the user no way to fix a wrong match**,
and a wrong match is the most common failure in this domain. Split into
`/parse` (structure plus candidates, confirm or correct) and `/analyze`.

**10. Confidence buckets are unmeasurable.** "Exact weights → 95–99%" collapses
on a mixed recipe. A dish with weighed chicken and a vague glug of oil is neither
95% nor 50%. Corrected: score each ingredient on match quality and quantity
precision, then aggregate weighted by that ingredient's *share of calories*, so a
hand-waved pinch of turmeric cannot move the number and a hand-waved oil can.

**11. Sodium was treated like the other nutrients.** Added salt dominates sodium
and nobody quantifies it. Sodium now gets its own confidence figure, capped at
30% when no salt appears in the recipe at all.

**12. Nothing was reproducible or cacheable.** Every request would have paid for
a model call and could return a different number for the same sentence. Added a
rules-first parser that handles the common case with no model at all, a
deterministic pipeline after parsing, and a hash of the parsed structure as a
cache key.

**13. No user-correction loop.** "Continuous learning from user corrections" sat
in Future Enhancements, but the table that makes it possible has to exist from
day one or the signal is lost. Added `user_corrections`.

---

## Part 2 — The corrected design

```
text
 ↓  parser        rules first, LLM only when rules struggle, strict JSON, temp 0
ParsedRecipe      validated by Pydantic before any arithmetic
 ↓  matcher       exact → alias → fuzzy → ask; never a silent guess
 ↓  converter     food-specific units, density, refuse %, cooked→raw yield
 ↓  nutrition     (grams / 100) × per-100g, summed. Pure arithmetic.
 ↓  cooking       absorbed fat, leaching, cooked weight. Macros conserved.
 ↓  servings      totals ÷ servings
 ↓  confidence    calorie-weighted, separate tracks for sodium and cooked weight
AnalysisResponse  with every assumption written down per ingredient
```

Two design rules carry most of the value:

**The model is a parser, not a calculator.** It receives the canonical
ingredient vocabulary and must pick from it or return null. It is forbidden from
emitting nutrition. Output is Pydantic-validated with one repair retry, then the
rule-based result is used. The service degrades, it never fails.

**Every number explains itself.** Each ingredient in the response carries how it
was matched, what weight was used, what basis produced that weight, and every
assumption applied. Users forgive an estimate. They do not forgive an estimate
they cannot interrogate.

### Reference tables shipped

| File | Rows | Purpose |
|---|---|---|
| `ingredients.csv` | 88 | raw ingredient composition, refuse %, cooked yield, density |
| `aliases.csv` | 159 | Hindi/regional/colloquial → canonical, the real matcher |
| `household_units.csv` | 90 | food-specific gram weights, with category and generic fallbacks |
| `cooking_methods.csv` | 14 | moisture, leaching, fat absorption, confidence penalty |

The nutrition values are typical published figures for seeding and testing.
Before launch, replace them with a licensed source: IFCT 2017 (ICMR-NIN) for
Indian ingredients, or USDA FoodData Central SR Legacy (public domain) for
generics. The column layout already matches both.

### Worked example

Input:

> I made chicken curry using 500g chicken breast, 2 medium onions, 3 tomatoes,
> 2 tbsp sunflower oil, turmeric, coriander powder, chili powder and cooked it
> for about 30 minutes. It serves 4 people.

Output:

```
total        999 kcal   118.0 P   42.7 F   33.2 C   9.7 fibre   249 mg Na
per serving  250 kcal    29.5 P   10.7 F    8.3 C   2.4 fibre    62 mg Na
cooked weight ~781 g estimated from 988 g of raw input

confidence   energy/macros 87   sodium 30   cooked weight 50
suggestion   Add the salt you used; it usually accounts for most of the sodium

500g chicken breast  → Chicken Breast (skinless)  alias  500 g  600 kcal
2 medium onions      → Onion                      alias  198 g   79 kcal   (220 g gross, 10% refuse)
3 tomatoes           → Tomato                     alias  254 g   46 kcal   (no size given, 1 medium = 90 g)
2 tbsp sunflower oil → Sunflower Oil              exact   28 g  248 kcal   (1 tbsp fat = 14 g)
turmeric             → Turmeric Powder            alias    3 g    9 kcal   (assumed 1 tsp)
```

The spec's own example predicted 1214 kcal and 164 g protein for this recipe.
The difference is almost entirely the raw/cooked confusion described above.

---

## Part 3 — Running it

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload        # http://localhost:8000/docs
pytest -q                            # 22 tests
python demo.py                       # worked examples on the console
```

No database and no API key are needed to run or test. Postgres is optional:

```bash
export DATABASE_URL=postgresql+psycopg://user:pass@host/db
python -m app.db.seed
```

### Wiring the LLM

`HybridParser` takes any callable that maps a prompt to a string, so the engine
stays provider-agnostic and testable offline:

```python
from app.services.parser import HybridParser, LLMParser
from app.services.pipeline import RecipeAnalyzer

def complete(prompt: str) -> str:
    ...  # Gemini / OpenAI call, temperature 0, JSON response mode

analyzer = RecipeAnalyzer(parser=HybridParser(llm=LLMParser(complete)))
```

The prompt is built by `LLMParser.build_prompt`, which sends a retrieved slice of
the vocabulary rather than all 1,000+ names, keeping cost and latency down.

### Layout

```
app/
  schemas.py            Pydantic contracts for every boundary
  repository.py         CSV-backed reference data + normalisation
  services/
    parser.py           rule-based + LLM + hybrid routing
    matcher.py          exact → alias → fuzzy → unresolved
    converter.py        units, density, refuse, cooked→raw
    nutrition.py        deterministic arithmetic + Atwater sanity check
    cooking.py          absorbed fat, leaching, cooked weight
    confidence.py       calorie-weighted scoring
    pipeline.py         orchestration
  api/routes.py         FastAPI surface
  db/                   SQLAlchemy models + seeder (optional Postgres path)
  data/                 the four reference CSVs
tests/test_engine.py    22 tests, one per failure mode
demo.py
```

---

## Part 4 — What to do next

1. **Swap in licensed nutrition data.** The current table is a seed. Accuracy is
   bounded by this, not by the code.
2. **Grow the alias table from real logs.** Every unresolved ingredient in
   `recipe_analyses` is a missing alias. This is the highest-return maintenance
   task in the project and it never ends.
3. **Build a golden set.** Twenty home recipes with weighed ingredients and
   hand-computed totals, asserted in CI. Without it, a tweak to one conversion
   silently moves thousands of users' numbers.
4. **Add auth and a rate limit before the LLM path goes public.** An unmetered
   endpoint that calls a paid model is a billing incident waiting to happen.
5. **Then** consider the Future Enhancements list. Voice and image input both
   feed this same parser; none of them help if the ingredient table is thin.
