"""Deterministic per-ingredient nutrition.

Pure arithmetic, no model calls, no randomness. Given the same resolved
ingredients this returns byte-identical numbers forever, which is what makes
the output auditable and testable.
"""

from __future__ import annotations

from app.repository import Ingredient
from app.schemas import Nutrients


def for_weight(ing: Ingredient, grams: float) -> Nutrients:
    """nutrition = (grams / 100) x per_100g. That part of the spec was right."""
    return ing.per100g.scaled(grams / 100.0)


def sum_all(items: list[Nutrients]) -> Nutrients:
    total = Nutrients()
    for item in items:
        total = total + item
    return total


def atwater_check(n: Nutrients, tolerance: float = 0.20) -> tuple[bool, float]:
    """Sanity gate: do the macros explain the calories?

    kcal ~= 4P + 4C + 9F, with fibre contributing about 2 kcal/g. A mismatch
    beyond tolerance means a bad database row or a bad conversion, and the
    response should carry a warning rather than a confident wrong number.
    """
    implied = 4 * n.protein_g + 4 * (n.carbs_g - n.fiber_g) + 9 * n.fat_g + 2 * n.fiber_g
    if n.kcal <= 0:
        return implied <= 1.0, implied
    drift = abs(implied - n.kcal) / n.kcal
    return drift <= tolerance, implied
