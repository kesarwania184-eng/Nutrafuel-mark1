"""Confidence.

The original buckets ("exact weights -> 95-99%") are not measurable and do not
survive a mixed recipe. A recipe with 500 g of weighed chicken and a vague
"some oil" is not 90% confident on fat and not 40% confident on protein.

This model scores each ingredient, then aggregates weighted by that
ingredient's share of total calories, so a vague pinch of turmeric cannot drag
the score down and a hand-waved glug of oil cannot hide inside it.

Three separate numbers are reported, because they fail independently:
  energy_macros  - the number people actually track
  sodium         - dominated by unquantified added salt, usually much worse
  cooked_weight  - needed only if the user later logs a portion by weight
"""

from __future__ import annotations

from app.repository import ReferenceData
from app.schemas import ConfidenceReport, IngredientResult, MatchMethod, ParsedRecipe, QuantityKind

MATCH_SCORE = {
    MatchMethod.EXACT: 1.00,
    MatchMethod.ALIAS: 0.97,
    MatchMethod.FUZZY: 0.80,
    MatchMethod.UNRESOLVED: 0.0,
}

QUANTITY_SCORE = {
    QuantityKind.MASS: 1.00,
    QuantityKind.VOLUME: 0.95,
    QuantityKind.COUNT: 0.80,
    QuantityKind.HOUSEHOLD: 0.75,
    QuantityKind.VAGUE: 0.40,
    QuantityKind.MISSING: 0.25,
}

W_MATCH, W_QTY = 0.45, 0.55


def score_ingredient(result: IngredientResult, quantity_kind: QuantityKind) -> float:
    match = MATCH_SCORE.get(result.match_method, 0.0)
    if result.match_method == MatchMethod.FUZZY:
        # Scale within the fuzzy band rather than treating 71 and 99 alike.
        match = 0.60 + 0.35 * min(max((result.match_score - 70) / 30.0, 0.0), 1.0)
    qty = QUANTITY_SCORE.get(quantity_kind, 0.3)
    generic = any("generic fallback" in a for a in result.assumptions)
    penalty = 0.85 if generic else 1.0
    return round(min(W_MATCH * match + W_QTY * qty, 1.0) * penalty, 4)


def build(
    results: list[IngredientResult],
    parsed: ParsedRecipe,
    quantity_kinds: dict[str, QuantityKind],
    method_penalty: float,
    cooked_weight_confident: bool,
    unresolved: list[str],
    ref: ReferenceData,
) -> ConfidenceReport:
    drivers: list[str] = []
    suggestions: list[str] = []

    total_kcal = sum(r.nutrition.kcal for r in results) or 1.0
    weighted = 0.0
    for r in results:
        share = r.nutrition.kcal / total_kcal
        r.kcal_share = round(share, 4)
        r.confidence = score_ingredient(r, quantity_kinds.get(r.raw_text, QuantityKind.MISSING))
        weighted += share * r.confidence

    # Unresolved ingredients carry unknown calories, so they cannot be weighted
    # by a share we do not have. Charge a flat penalty instead.
    if unresolved:
        weighted *= max(0.55, 1 - 0.18 * len(unresolved))
        drivers.append(f"{len(unresolved)} ingredient(s) not found in the database")
        suggestions.append(
            "Confirm or replace the unmatched items: " + ", ".join(unresolved[:4])
        )

    energy = weighted * method_penalty
    if parsed.method is None:
        energy *= 0.95
        suggestions.append("Tell us the cooking method (curry, deep fried, grilled) for a better estimate")

    low = sorted(
        [r for r in results if r.confidence < 0.75 and r.kcal_share > 0.08],
        key=lambda r: -r.kcal_share,
    )
    for r in low[:3]:
        drivers.append(
            f"{r.matched_name or r.raw_text} is {r.kcal_share * 100:.0f}% of calories "
            f"but was entered imprecisely"
        )
        suggestions.append(f"Weigh the {r.matched_name or r.raw_text} in grams")

    # --- sodium ---------------------------------------------------------------
    salt_entered = any(r.ingredient_id == "salt" for r in results)
    salt_quantified = any(
        r.ingredient_id == "salt"
        and quantity_kinds.get(r.raw_text) in {QuantityKind.MASS, QuantityKind.HOUSEHOLD}
        for r in results
    )
    if not salt_entered:
        sodium = min(energy, 0.30)
        drivers.append("No added salt in the recipe, so sodium is almost certainly understated")
        suggestions.append("Add the salt you used; it usually accounts for most of the sodium")
    elif not salt_quantified:
        sodium = min(energy, 0.45)
        suggestions.append("Give the salt amount in tsp or grams")
    else:
        sodium = energy * 0.9

    cooked = 0.85 if cooked_weight_confident else 0.5
    if parsed.servings is None:
        suggestions.append("Tell us how many servings the dish makes")

    def pct(x: float) -> int:
        return int(round(max(0.05, min(x, 0.99)) * 100))

    return ConfidenceReport(
        overall=pct(energy),
        energy_macros=pct(energy),
        sodium=pct(sodium),
        cooked_weight=pct(cooked),
        drivers=drivers[:5],
        suggestions=list(dict.fromkeys(suggestions))[:5],
    )
