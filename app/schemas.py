"""Pydantic contracts for every boundary in the pipeline.

The LLM never emits nutrition numbers. It emits ParsedRecipe and nothing else,
and ParsedRecipe is validated before any arithmetic touches it.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# --------------------------------------------------------------------------- #
# Parsing layer (LLM output)
# --------------------------------------------------------------------------- #


class QuantityKind(str, Enum):
    """How precisely the user expressed an amount. Drives the confidence model."""

    MASS = "mass"  # "500g", "1.2 kg"
    VOLUME = "volume"  # "250 ml"
    COUNT = "count"  # "2 medium onions", "3 eggs"
    HOUSEHOLD = "household"  # "2 tbsp", "1 katori"
    VAGUE = "vague"  # "some", "a little", "as required"
    MISSING = "missing"  # user never said


class ParsedIngredient(BaseModel):
    raw_text: str = Field(..., description="Exact span the user wrote, for explainability")
    food: str = Field(..., description="Canonical ingredient name, or the user's word if unknown")
    quantity: float | None = None
    unit: str | None = None
    qualifier: str | None = Field(
        default=None, description="e.g. 'chopped', 'boiled', 'for frying'"
    )
    quantity_kind: QuantityKind = QuantityKind.MISSING

    @field_validator("quantity")
    @classmethod
    def _sane_quantity(cls, v: float | None) -> float | None:
        if v is not None and (v <= 0 or v > 100_000):
            raise ValueError("quantity out of plausible range")
        return v


class ParsedRecipe(BaseModel):
    """The ONLY thing the LLM is allowed to produce."""

    dish_name: str | None = None
    ingredients: list[ParsedIngredient] = Field(default_factory=list)
    method: str | None = Field(default=None, description="Key of cooking_methods table")
    cook_time_min: int | None = None
    servings: float | None = None
    unparsed_text: list[str] = Field(
        default_factory=list, description="Spans the parser could not interpret"
    )


# --------------------------------------------------------------------------- #
# Matching / conversion layer
# --------------------------------------------------------------------------- #


class MatchMethod(str, Enum):
    EXACT = "exact"
    ALIAS = "alias"
    FUZZY = "fuzzy"
    UNRESOLVED = "unresolved"


class IngredientMatch(BaseModel):
    query: str
    ingredient_id: str | None = None
    matched_name: str | None = None
    method: MatchMethod = MatchMethod.UNRESOLVED
    score: float = 0.0
    needs_confirmation: bool = False
    candidates: list[dict] = Field(default_factory=list)


class Nutrients(BaseModel):
    kcal: float = 0.0
    protein_g: float = 0.0
    fat_g: float = 0.0
    carbs_g: float = 0.0
    fiber_g: float = 0.0
    sodium_mg: float = 0.0

    def __add__(self, other: "Nutrients") -> "Nutrients":
        return Nutrients(
            kcal=self.kcal + other.kcal,
            protein_g=self.protein_g + other.protein_g,
            fat_g=self.fat_g + other.fat_g,
            carbs_g=self.carbs_g + other.carbs_g,
            fiber_g=self.fiber_g + other.fiber_g,
            sodium_mg=self.sodium_mg + other.sodium_mg,
        )

    def scaled(self, factor: float) -> "Nutrients":
        return Nutrients(
            kcal=self.kcal * factor,
            protein_g=self.protein_g * factor,
            fat_g=self.fat_g * factor,
            carbs_g=self.carbs_g * factor,
            fiber_g=self.fiber_g * factor,
            sodium_mg=self.sodium_mg * factor,
        )

    def rounded(self) -> "Nutrients":
        return Nutrients(
            kcal=round(self.kcal),
            protein_g=round(self.protein_g, 1),
            fat_g=round(self.fat_g, 1),
            carbs_g=round(self.carbs_g, 1),
            fiber_g=round(self.fiber_g, 1),
            sodium_mg=round(self.sodium_mg),
        )


class IngredientResult(BaseModel):
    """One fully resolved ingredient, with every assumption made explicit."""

    raw_text: str
    matched_name: str | None
    ingredient_id: str | None
    match_method: MatchMethod
    match_score: float
    needs_confirmation: bool
    gross_weight_g: float | None
    edible_weight_g: float | None
    conversion_basis: str
    assumptions: list[str] = Field(default_factory=list)
    nutrition: Nutrients = Field(default_factory=Nutrients)
    kcal_share: float = 0.0
    confidence: float = 0.0
    candidates: list[dict] = Field(default_factory=list)


class ConfidenceReport(BaseModel):
    overall: int
    energy_macros: int
    sodium: int
    cooked_weight: int
    drivers: list[str] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)


class AnalysisResponse(BaseModel):
    dish_name: str | None
    method: str
    servings: float
    ingredients: list[IngredientResult]
    unresolved: list[str]
    total_nutrition: Nutrients
    per_serving: Nutrients
    per_100g_cooked: Nutrients
    estimated_cooked_weight_g: float
    confidence: ConfidenceReport
    warnings: list[str] = Field(default_factory=list)
    parse_source: Literal["llm", "rules", "client"] = "rules"
    parsed_recipe: ParsedRecipe


class AnalyzeRequest(BaseModel):
    recipe: str | None = None
    parsed: ParsedRecipe | None = Field(
        default=None,
        description="Skip the LLM entirely and analyse a user-confirmed structure",
    )
    servings_override: float | None = None
    method_override: str | None = None
