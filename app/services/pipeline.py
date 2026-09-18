"""Orchestration.

parse -> match -> convert -> nutrition -> cooking -> serve -> confidence

Every stage is pure given its inputs, so the whole pipeline is deterministic
once parsing is done. That is what lets you cache on a hash of ParsedRecipe and
regression-test against a golden set of known dishes.
"""

from __future__ import annotations

import hashlib
import json

from app.repository import ReferenceData, load_reference_data
from app.schemas import (
    AnalysisResponse,
    AnalyzeRequest,
    IngredientResult,
    MatchMethod,
    Nutrients,
    ParsedRecipe,
    QuantityKind,
)
from app.services import cooking, confidence, converter, matcher, nutrition
from app.services.parser import HybridParser


def parsed_hash(parsed: ParsedRecipe) -> str:
    blob = json.dumps(parsed.model_dump(mode="json"), sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


class RecipeAnalyzer:
    def __init__(self, ref: ReferenceData | None = None, parser: HybridParser | None = None):
        self.ref = ref or load_reference_data()
        self.parser = parser or HybridParser()

    # -- public ------------------------------------------------------------- #

    def analyze(self, request: AnalyzeRequest) -> AnalysisResponse:
        if request.parsed is not None:
            parsed, source = request.parsed, "client"
        elif request.recipe:
            parsed, source = self.parser.parse(request.recipe, self.ref)
        else:
            raise ValueError("Provide either `recipe` text or a `parsed` structure")

        if request.method_override:
            parsed.method = request.method_override
        if request.servings_override:
            parsed.servings = request.servings_override

        return self._run(parsed, source)

    # -- internals ---------------------------------------------------------- #

    def _run(self, parsed: ParsedRecipe, source: str) -> AnalysisResponse:
        ref = self.ref
        results: list[IngredientResult] = []
        unresolved: list[str] = []
        warnings: list[str] = []
        quantity_kinds: dict[str, QuantityKind] = {}

        for item in parsed.ingredients:
            match = matcher.match_ingredient(item.food, ref)
            ing = ref.get(match.ingredient_id) if match.ingredient_id else None

            if ing is None:
                unresolved.append(item.raw_text or item.food)
                results.append(
                    IngredientResult(
                        raw_text=item.raw_text or item.food,
                        matched_name=None,
                        ingredient_id=None,
                        match_method=MatchMethod.UNRESOLVED,
                        match_score=match.score,
                        needs_confirmation=True,
                        gross_weight_g=None,
                        edible_weight_g=None,
                        conversion_basis="not calculated",
                        assumptions=["Ingredient not in database; excluded from totals"],
                        candidates=match.candidates,
                    )
                )
                quantity_kinds[item.raw_text or item.food] = item.quantity_kind
                continue

            conv = converter.convert(item.quantity, item.unit, ing, ref, item.quantity_kind)
            assumptions = list(conv.assumptions)

            if conv.edible_g is None:
                unresolved.append(item.raw_text or item.food)
                results.append(
                    IngredientResult(
                        raw_text=item.raw_text or item.food,
                        matched_name=ing.name,
                        ingredient_id=ing.id,
                        match_method=match.method,
                        match_score=match.score,
                        needs_confirmation=True,
                        gross_weight_g=None,
                        edible_weight_g=None,
                        conversion_basis=conv.basis,
                        assumptions=assumptions,
                        candidates=match.candidates,
                    )
                )
                quantity_kinds[item.raw_text or item.food] = conv.quantity_kind
                continue

            weight, yield_notes = converter.to_raw_equivalent(conv.edible_g, ing, item.qualifier)
            assumptions.extend(yield_notes)

            results.append(
                IngredientResult(
                    raw_text=item.raw_text or item.food,
                    matched_name=ing.name,
                    ingredient_id=ing.id,
                    match_method=match.method,
                    match_score=match.score,
                    needs_confirmation=match.needs_confirmation,
                    gross_weight_g=conv.gross_g,
                    edible_weight_g=round(weight, 2),
                    conversion_basis=conv.basis,
                    assumptions=assumptions,
                    nutrition=nutrition.for_weight(ing, weight).rounded(),
                    candidates=match.candidates,
                )
            )
            quantity_kinds[item.raw_text or item.food] = conv.quantity_kind

        raw_total = nutrition.sum_all([r.nutrition for r in results])
        method = ref.method(parsed.method)
        outcome = cooking.apply(raw_total, results, method, ref)
        warnings.extend(outcome.warnings)

        total = outcome.nutrition
        ok, implied = nutrition.atwater_check(total)
        if not ok:
            warnings.append(
                f"Macros imply about {implied:.0f} kcal against a reported {total.kcal:.0f} kcal. "
                "Check the database rows used here."
            )

        servings = parsed.servings or 1.0
        if parsed.servings is None:
            warnings.append("No serving count given; totals are reported for the whole dish")

        report = confidence.build(
            results=results,
            parsed=parsed,
            quantity_kinds=quantity_kinds,
            method_penalty=method.confidence_penalty,
            cooked_weight_confident=outcome.cooked_weight_confident,
            unresolved=unresolved,
            ref=ref,
        )

        cooked_weight = outcome.cooked_weight_g
        return AnalysisResponse(
            dish_name=parsed.dish_name,
            method=method.method,
            servings=servings,
            ingredients=results,
            unresolved=unresolved,
            total_nutrition=total.rounded(),
            per_serving=total.scaled(1 / servings).rounded(),
            per_100g_cooked=total.scaled(100 / cooked_weight).rounded(),
            estimated_cooked_weight_g=cooked_weight,
            confidence=report,
            warnings=warnings + outcome.notes,
            parse_source=source,  # type: ignore[arg-type]
            parsed_recipe=parsed,
        )
