"""Quantity -> grams of edible matter.

Three corrections over the original spec:

1. Household units are food-specific. One cup is 185 g of raw rice, 245 g of
   milk, 120 g of atta and 16 g of coriander leaves. A single `unit -> grams`
   table is wrong by up to 15x. Lookup order is
   (unit, ingredient) -> (unit, category) -> (unit, generic).

2. Volume units resolve through density when the ingredient has one, so
   "250 ml milk" becomes 257 g rather than 250 g.

3. Gross weight is not edible weight. "2 medium onions" is 220 g on the scale
   and about 198 g in the pan. Bone-in chicken is 28% refuse. Nutrition is
   computed on the edible portion.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.repository import Ingredient, ReferenceData, normalize
from app.schemas import QuantityKind

MASS_UNITS = {"g": 1.0, "gram": 1.0, "grams": 1.0, "gm": 1.0, "kg": 1000.0, "kilogram": 1000.0}
VOLUME_UNITS = {"ml": 1.0, "millilitre": 1.0, "l": 1000.0, "litre": 1000.0, "liter": 1000.0}

# Sane defaults for ingredients users routinely leave unquantified.
# Calorie impact is negligible for spices; sodium impact of salt is not, which is
# why salt gets its own confidence treatment downstream.
DEFAULT_AMOUNTS: dict[str, tuple[float, str]] = {
    "spice": (1.0, "tsp"),
    "herb": (2.0, "tbsp"),
    "aromatic": (10.0, "g"),
    "seasoning": (1.0, "tsp"),
}


@dataclass
class ConversionResult:
    gross_g: float | None
    edible_g: float | None
    basis: str
    assumptions: list[str]
    quantity_kind: QuantityKind


def _unit_grams(unit: str, ing: Ingredient | None, ref: ReferenceData) -> tuple[float | None, str]:
    unit = normalize(unit)
    if ing is not None:
        g = ref.unit_by_ingredient.get((unit, ing.id))
        if g is not None:
            return g, f"1 {unit} of {ing.name} = {g:g} g"
        # "3 tomatoes" carries no size word. Prefer this food's medium weight
        # over the generic 50 g piece, which is wrong for most produce.
        if unit in {"piece", "no", "nos", "pc"}:
            g = ref.unit_by_ingredient.get(("medium", ing.id))
            if g is not None:
                return g, f"1 medium {ing.name} = {g:g} g (no size given)"
        g = ref.unit_by_category.get((unit, ing.category))
        if g is not None:
            return g, f"1 {unit} of a {ing.category} = {g:g} g (category default)"
    g = ref.unit_generic.get(unit)
    if g is not None:
        return g, f"1 {unit} = {g:g} g (generic fallback)"
    return None, ""


def convert(
    quantity: float | None,
    unit: str | None,
    ing: Ingredient | None,
    ref: ReferenceData,
    quantity_kind: QuantityKind = QuantityKind.MISSING,
) -> ConversionResult:
    assumptions: list[str] = []
    unit_n = normalize(unit or "")

    if quantity is None:
        if ing is not None and ing.category in DEFAULT_AMOUNTS:
            quantity, unit_n = DEFAULT_AMOUNTS[ing.category]
            quantity_kind = QuantityKind.VAGUE
            assumptions.append(f"No amount given; assumed {quantity:g} {unit_n}")
        else:
            return ConversionResult(None, None, "no quantity", ["Amount missing"], QuantityKind.MISSING)

    gross: float | None = None
    basis = ""

    if unit_n in MASS_UNITS:
        gross = quantity * MASS_UNITS[unit_n]
        basis = f"{quantity:g} {unit_n}"
        quantity_kind = QuantityKind.MASS
    elif unit_n in VOLUME_UNITS:
        ml = quantity * VOLUME_UNITS[unit_n]
        density = (ing.density_g_per_ml if ing and ing.density_g_per_ml else 1.0)
        gross = ml * density
        basis = f"{ml:g} ml x {density:g} g/ml"
        if ing and ing.density_g_per_ml:
            assumptions.append(f"Used density {density:g} g/ml for {ing.name}")
        else:
            assumptions.append("No density on file; assumed 1.0 g/ml")
        quantity_kind = QuantityKind.VOLUME
    else:
        grams, note = _unit_grams(unit_n or "piece", ing, ref)
        if grams is None:
            return ConversionResult(
                None, None, f"unknown unit '{unit_n}'",
                [f"Unit '{unit_n}' not in the conversion table"], quantity_kind,
            )
        gross = quantity * grams
        basis = f"{quantity:g} x {grams:g} g"
        assumptions.append(note)
        if quantity_kind in (QuantityKind.MISSING, QuantityKind.VAGUE):
            quantity_kind = QuantityKind.HOUSEHOLD
        if "generic fallback" in note:
            assumptions.append("Weight is a generic fallback and may be well off")

    refuse = ing.refuse_pct if ing else 0.0
    edible = gross * (1 - refuse / 100.0)
    if refuse:
        assumptions.append(
            f"Removed {refuse:g}% inedible portion ({gross:.0f} g gross -> {edible:.0f} g edible)"
        )

    return ConversionResult(
        gross_g=round(gross, 2),
        edible_g=round(edible, 2),
        basis=basis,
        assumptions=[a for a in assumptions if a],
        quantity_kind=quantity_kind,
    )


def to_raw_equivalent(edible_g: float, ing: Ingredient, qualifier: str | None) -> tuple[float, list[str]]:
    """Handle 'one cup of cooked rice' against a raw-rice database row.

    Without this the engine reports roughly 2.6x the real calories for every
    cooked grain and pulse a user enters. This is the single largest source of
    error in naive recipe calculators.
    """
    notes: list[str] = []
    said_cooked = bool(qualifier and "cook" in qualifier.lower() or qualifier and "boil" in qualifier.lower())
    if said_cooked and ing.state == "raw" and ing.cooked_yield and ing.cooked_yield > 1:
        raw_g = edible_g / ing.cooked_yield
        notes.append(
            f"Entered as cooked; converted to {raw_g:.0f} g raw using a {ing.cooked_yield:g}x yield"
        )
        return raw_g, notes
    return edible_g, notes
