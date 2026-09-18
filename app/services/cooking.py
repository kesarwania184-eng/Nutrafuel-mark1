"""Cooking adjustment.

The original design was wrong on physics in two places, and both errors inflate
calories:

1. "Water loss 20% -> calories unchanged" was stated but the table implied the
   adjustment engine scales nutrition by it. Water leaving a pan removes mass,
   not energy. Macros are conserved under every domestic cooking method.
   Moisture only changes (a) the cooked weight and (b) the per-100g density.

2. "Oil gain g/100g" added on top of user-itemised oil double counts. If the
   user already told us about 2 tbsp of oil, that oil is in the totals. Oil
   absorption is only real when the frying medium is *not* itemised, i.e. a
   deep-fry bath the user never weighed.

What cooking genuinely changes:
  - mass, and therefore cooked weight and per-100g values
  - water-soluble minerals when cooking liquid is discarded (drained dal, boiled
    veg). Modelled on sodium here; extend to potassium and B-vitamins once those
    columns exist.
  - absorbed fat in an unitemised deep fry
"""

from __future__ import annotations

from dataclasses import dataclass

from app.repository import CookingMethod, ReferenceData
from app.schemas import IngredientResult, Nutrients


@dataclass
class CookingOutcome:
    nutrition: Nutrients
    cooked_weight_g: float
    cooked_weight_confident: bool
    warnings: list[str]
    notes: list[str]


def apply(
    totals: Nutrients,
    results: list[IngredientResult],
    method: CookingMethod,
    ref: ReferenceData,
) -> CookingOutcome:
    warnings: list[str] = []
    notes: list[str] = []
    adjusted = totals
    excluded_fat_g = 0.0

    fat_items = [
        r for r in results
        if r.ingredient_id and ref.ingredients[r.ingredient_id].category == "fat"
    ]
    itemised_fat_g = sum(r.edible_weight_g or 0.0 for r in fat_items)
    non_fat_g = sum(
        (r.edible_weight_g or 0.0) for r in results
        if r not in fat_items and r.ingredient_id
    )

    # --- absorbed fat, only where it is not already counted -------------------
    if method.fat_absorbed_g_per_100g > 0 and non_fat_g > 0:
        estimate = method.fat_absorbed_g_per_100g * non_fat_g / 100.0
        if itemised_fat_g > 0:
            absorbed = min(itemised_fat_g, estimate)
            removed = itemised_fat_g - absorbed
            if removed > 0:
                excluded_fat_g = removed
                # The bath is not eaten. Subtract the oil that stays in the kadhai.
                oil = ref.ingredients[fat_items[0].ingredient_id]
                adjusted = adjusted + oil.per100g.scaled(-removed / 100.0)
                notes.append(
                    f"Deep fry: of {itemised_fat_g:.0f} g oil, about {absorbed:.0f} g is absorbed; "
                    f"{removed:.0f} g stays in the pan and was excluded"
                )
        else:
            oil = ref.ingredients.get("sunflower_oil")
            if oil:
                adjusted = adjusted + oil.per100g.scaled(estimate / 100.0)
                notes.append(
                    f"Deep fry with no oil quantity given: added {estimate:.0f} g absorbed oil "
                    f"({method.fat_absorbed_g_per_100g:g} g per 100 g of food)"
                )
                warnings.append(
                    "Absorbed oil in deep frying varies roughly 6-12 g per 100 g. "
                    "Weigh the oil before and after for a real number."
                )

    # --- leaching into discarded cooking liquid -------------------------------
    if method.drains_liquid and method.leach_loss_pct > 0:
        keep = 1 - method.leach_loss_pct / 100.0
        adjusted = Nutrients(
            kcal=adjusted.kcal,
            protein_g=adjusted.protein_g,
            fat_g=adjusted.fat_g,
            carbs_g=adjusted.carbs_g,
            fiber_g=adjusted.fiber_g,
            sodium_mg=adjusted.sodium_mg * keep,
        )
        notes.append(
            f"Cooking water discarded: {method.leach_loss_pct:g}% of soluble minerals lost. "
            "Energy and macros are unchanged."
        )

    # --- cooked weight --------------------------------------------------------
    raw_weight = sum(r.edible_weight_g or 0.0 for r in results)
    yielded = 0.0
    for r in results:
        if not r.ingredient_id or r.edible_weight_g is None:
            continue
        ing = ref.ingredients[r.ingredient_id]
        if ing.cooked_yield and method.method != "raw":
            yielded += r.edible_weight_g * ing.cooked_yield
        else:
            yielded += r.edible_weight_g * method.moisture_factor

    yielded = max(yielded - excluded_fat_g, 1.0)

    confident = method.method in {"raw", "steamed", "boiled", "pressure_cooked"}
    if method.method in {"curry", "gravy"}:
        warnings.append(
            "Water added during simmering is not in the recipe text, so cooked weight "
            "and per-100g values are rough. Per-serving values are unaffected."
        )
    notes.append(f"Estimated cooked weight {yielded:.0f} g from {raw_weight:.0f} g of raw input")

    return CookingOutcome(
        nutrition=adjusted,
        cooked_weight_g=round(max(yielded, 1.0), 1),
        cooked_weight_confident=confident,
        warnings=warnings,
        notes=notes,
    )
