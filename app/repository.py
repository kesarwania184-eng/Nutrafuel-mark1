"""Reference-data access.

Backed by CSV so the engine runs and is testable with zero infrastructure.
`app/db/models.py` holds the equivalent SQLAlchemy tables, and `app/db/seed.py`
loads these same CSVs into Postgres when you are ready to move.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from app.schemas import Nutrients

DATA_DIR = Path(__file__).parent / "data"


def _f(value: str, default: float = 0.0) -> float:
    value = (value or "").strip()
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default


@dataclass(frozen=True)
class Ingredient:
    id: str
    name: str
    category: str
    state: str  # raw | cooked
    per100g: Nutrients
    refuse_pct: float  # inedible portion of gross weight (peel, bone, stalk)
    cooked_yield: float  # cooked weight / raw weight, 0 when not applicable
    density_g_per_ml: float | None


@dataclass(frozen=True)
class CookingMethod:
    method: str
    moisture_factor: float
    leach_loss_pct: float
    fat_absorbed_g_per_100g: float
    drains_liquid: bool
    confidence_penalty: float
    note: str


@dataclass
class ReferenceData:
    ingredients: dict[str, Ingredient] = field(default_factory=dict)
    by_normalized_name: dict[str, str] = field(default_factory=dict)
    aliases: dict[str, str] = field(default_factory=dict)
    # (unit, ingredient_id) -> grams ; (unit, category) -> grams ; (unit, None) -> grams
    unit_by_ingredient: dict[tuple[str, str], float] = field(default_factory=dict)
    unit_by_category: dict[tuple[str, str], float] = field(default_factory=dict)
    unit_generic: dict[str, float] = field(default_factory=dict)
    cooking_methods: dict[str, CookingMethod] = field(default_factory=dict)

    def get(self, ingredient_id: str) -> Ingredient | None:
        return self.ingredients.get(ingredient_id)

    def method(self, name: str | None) -> CookingMethod:
        return self.cooking_methods.get(name or "raw", self.cooking_methods["raw"])

    @property
    def canonical_names(self) -> list[str]:
        return [ing.name for ing in self.ingredients.values()]


def normalize(text: str) -> str:
    """Lowercase, strip punctuation and collapse whitespace.

    Deliberately conservative: matching correctness lives in the alias table,
    not in clever string surgery.
    """
    text = (text or "").lower().strip()
    out = []
    for ch in text:
        if ch.isalnum() or ch.isspace():
            out.append(ch)
        elif ch in "-/":
            out.append(" ")
    return " ".join("".join(out).split())


@lru_cache(maxsize=1)
def load_reference_data(data_dir: str | None = None) -> ReferenceData:
    base = Path(data_dir) if data_dir else DATA_DIR
    ref = ReferenceData()

    with open(base / "ingredients.csv", newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            ing = Ingredient(
                id=row["id"],
                name=row["name"],
                category=row["category"],
                state=row["state"],
                per100g=Nutrients(
                    kcal=_f(row["kcal"]),
                    protein_g=_f(row["protein_g"]),
                    fat_g=_f(row["fat_g"]),
                    carbs_g=_f(row["carbs_g"]),
                    fiber_g=_f(row["fiber_g"]),
                    sodium_mg=_f(row["sodium_mg"]),
                ),
                refuse_pct=_f(row["refuse_pct"]),
                cooked_yield=_f(row["cooked_yield"]),
                density_g_per_ml=_f(row["density_g_per_ml"]) or None,
            )
            ref.ingredients[ing.id] = ing
            ref.by_normalized_name[normalize(ing.name)] = ing.id
            # The display name often carries slash-separated synonyms.
            for part in ing.name.replace("(", " ").replace(")", " ").split("/"):
                part = normalize(part)
                if part:
                    ref.by_normalized_name.setdefault(part, ing.id)

    with open(base / "aliases.csv", newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            ref.aliases[normalize(row["alias"])] = row["ingredient_id"]

    with open(base / "household_units.csv", newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            unit = normalize(row["unit"])
            grams = _f(row["grams"])
            ing_id = (row.get("ingredient_id") or "").strip()
            category = (row.get("category") or "").strip()
            if ing_id:
                ref.unit_by_ingredient[(unit, ing_id)] = grams
            elif category:
                ref.unit_by_category[(unit, category)] = grams
            else:
                ref.unit_generic[unit] = grams

    with open(base / "cooking_methods.csv", newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            ref.cooking_methods[row["method"]] = CookingMethod(
                method=row["method"],
                moisture_factor=_f(row["moisture_factor"], 1.0),
                leach_loss_pct=_f(row["leach_loss_pct"]),
                fat_absorbed_g_per_100g=_f(row["fat_absorbed_g_per_100g"]),
                drains_liquid=row["drains_liquid"].strip().lower() == "true",
                confidence_penalty=_f(row["confidence_penalty"], 1.0),
                note=row.get("note", ""),
            )

    return ref
