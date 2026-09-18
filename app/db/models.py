"""SQLAlchemy schema for the Postgres path.

Note the split the original design was missing: `dishes` and `ingredients` are
two different tables with two different purposes.

  dishes      - INDB style finished-food rows. Used when the user logs
                "one plate of rajma chawal". Cannot be decomposed.
  ingredients - raw component rows. Used when the user describes a recipe.
                This is the table the recipe engine needs, and it is the one
                the 1,014-item catalogue does not give you.

Mixing them is the single most damaging modelling error available here: match
"chicken" in a recipe to a row for "Chicken Curry" and you multiply the real
figure several times over.
"""

from __future__ import annotations

from sqlalchemy import (
    Boolean, CheckConstraint, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Ingredient(Base):
    __tablename__ = "ingredients"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="raw")
    kcal: Mapped[float] = mapped_column(Float, nullable=False)
    protein_g: Mapped[float] = mapped_column(Float, nullable=False)
    fat_g: Mapped[float] = mapped_column(Float, nullable=False)
    carbs_g: Mapped[float] = mapped_column(Float, nullable=False)
    fiber_g: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    sodium_mg: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    refuse_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    cooked_yield: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    density_g_per_ml: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(64), default="seed")

    __table_args__ = (
        CheckConstraint("state in ('raw','cooked')", name="ck_ingredient_state"),
        CheckConstraint("refuse_pct >= 0 and refuse_pct < 100", name="ck_refuse_range"),
    )


class Dish(Base):
    """Finished foods, per 100 g and per typical serving. Never decomposed."""

    __tablename__ = "dishes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    kcal_per_100g: Mapped[float] = mapped_column(Float, nullable=False)
    protein_g: Mapped[float] = mapped_column(Float, nullable=False)
    fat_g: Mapped[float] = mapped_column(Float, nullable=False)
    carbs_g: Mapped[float] = mapped_column(Float, nullable=False)
    fiber_g: Mapped[float] = mapped_column(Float, default=0)
    sodium_mg: Mapped[float] = mapped_column(Float, default=0)
    serving_name: Mapped[str | None] = mapped_column(String(64))
    serving_g: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(64), default="indb")


class IngredientAlias(Base):
    __tablename__ = "ingredient_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    alias: Mapped[str] = mapped_column(String(128), nullable=False)
    alias_normalized: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    ingredient_id: Mapped[str] = mapped_column(ForeignKey("ingredients.id", ondelete="CASCADE"))
    language: Mapped[str | None] = mapped_column(String(16))

    __table_args__ = (UniqueConstraint("alias_normalized", name="uq_alias_normalized"),)


class HouseholdUnit(Base):
    """Keyed on (unit, ingredient) first, (unit, category) second, unit alone last.

    A single global unit table is wrong by an order of magnitude for flours,
    leaves and liquids.
    """

    __tablename__ = "household_units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    ingredient_id: Mapped[str | None] = mapped_column(
        ForeignKey("ingredients.id", ondelete="CASCADE")
    )
    category: Mapped[str | None] = mapped_column(String(32))
    grams: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_unit_lookup", "unit", "ingredient_id"),
        Index("ix_unit_category", "unit", "category"),
    )


class CookingMethodRow(Base):
    __tablename__ = "cooking_methods"

    method: Mapped[str] = mapped_column(String(32), primary_key=True)
    moisture_factor: Mapped[float] = mapped_column(Float, default=1.0)
    leach_loss_pct: Mapped[float] = mapped_column(Float, default=0)
    fat_absorbed_g_per_100g: Mapped[float] = mapped_column(Float, default=0)
    drains_liquid: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence_penalty: Mapped[float] = mapped_column(Float, default=1.0)
    note: Mapped[str | None] = mapped_column(Text)


class RecipeAnalysisLog(Base):
    """Every analysis, keyed by a hash of the parsed structure.

    Serves three purposes: caching so an identical recipe never pays for a
    second model call, reproducibility when a user disputes a number, and a
    training signal once corrections start arriving.
    """

    __tablename__ = "recipe_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(64), index=True)
    input_text: Mapped[str] = mapped_column(Text)
    parsed_hash: Mapped[str] = mapped_column(String(32), index=True)
    parsed_json: Mapped[str] = mapped_column(Text)
    response_json: Mapped[str] = mapped_column(Text)
    parse_source: Mapped[str] = mapped_column(String(16))
    confidence: Mapped[int] = mapped_column(Integer)


class UserCorrection(Base):
    """The most valuable table you will own.

    When a user changes a match or a weight, store it. Frequent corrections are
    free supervision for the alias table and the unit table, and they tell you
    exactly where the reference data is thin.
    """

    __tablename__ = "user_corrections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    analysis_id: Mapped[int] = mapped_column(ForeignKey("recipe_analyses.id", ondelete="CASCADE"))
    raw_text: Mapped[str] = mapped_column(String(256))
    predicted_ingredient_id: Mapped[str | None] = mapped_column(String(64))
    corrected_ingredient_id: Mapped[str | None] = mapped_column(String(64))
    corrected_grams: Mapped[float | None] = mapped_column(Float)
