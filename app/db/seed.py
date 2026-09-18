"""Load the CSV reference tables into Postgres.

    export DATABASE_URL=postgresql+psycopg://user:pass@host/db
    python -m app.db.seed
"""

from __future__ import annotations

import csv
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.models import (
    Base, CookingMethodRow, HouseholdUnit, Ingredient, IngredientAlias,
)
from app.repository import normalize

DATA = Path(__file__).resolve().parents[1] / "data"


def _f(v, default=0.0):
    v = (v or "").strip()
    try:
        return float(v)
    except ValueError:
        return default


def seed(url: str | None = None) -> None:
    url = url or os.environ["DATABASE_URL"]
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        with open(DATA / "ingredients.csv", newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                s.merge(Ingredient(
                    id=r["id"], name=r["name"], category=r["category"], state=r["state"],
                    kcal=_f(r["kcal"]), protein_g=_f(r["protein_g"]), fat_g=_f(r["fat_g"]),
                    carbs_g=_f(r["carbs_g"]), fiber_g=_f(r["fiber_g"]),
                    sodium_mg=_f(r["sodium_mg"]), refuse_pct=_f(r["refuse_pct"]),
                    cooked_yield=_f(r["cooked_yield"]),
                    density_g_per_ml=_f(r["density_g_per_ml"]) or None,
                ))
        with open(DATA / "aliases.csv", newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                s.merge(IngredientAlias(
                    alias=r["alias"], alias_normalized=normalize(r["alias"]),
                    ingredient_id=r["ingredient_id"],
                ))
        with open(DATA / "household_units.csv", newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                s.add(HouseholdUnit(
                    unit=normalize(r["unit"]),
                    ingredient_id=(r.get("ingredient_id") or "").strip() or None,
                    category=(r.get("category") or "").strip() or None,
                    grams=_f(r["grams"]), note=r.get("note"),
                ))
        with open(DATA / "cooking_methods.csv", newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                s.merge(CookingMethodRow(
                    method=r["method"], moisture_factor=_f(r["moisture_factor"], 1.0),
                    leach_loss_pct=_f(r["leach_loss_pct"]),
                    fat_absorbed_g_per_100g=_f(r["fat_absorbed_g_per_100g"]),
                    drains_liquid=r["drains_liquid"].strip().lower() == "true",
                    confidence_penalty=_f(r["confidence_penalty"], 1.0), note=r.get("note"),
                ))
        s.commit()
    print("seeded")


if __name__ == "__main__":
    seed()
