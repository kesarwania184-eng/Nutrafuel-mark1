"""HTTP surface.

Two endpoints instead of one, because a single fire-and-forget /analyze_recipe
gives the user no way to fix a wrong ingredient match, and a wrong match is the
most common failure in this domain.

    POST /v1/recipes/parse    -> structure + match candidates, no nutrition yet
    POST /v1/recipes/analyze  -> full numbers, accepts a user-confirmed structure
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.repository import load_reference_data
from app.schemas import AnalysisResponse, AnalyzeRequest, ParsedRecipe
from app.services import matcher
from app.services.pipeline import RecipeAnalyzer, parsed_hash

router = APIRouter(prefix="/v1")
_analyzer = RecipeAnalyzer()


@router.get("/health")
def health() -> dict:
    ref = load_reference_data()
    return {
        "status": "ok",
        "ingredients": len(ref.ingredients),
        "aliases": len(ref.aliases),
        "cooking_methods": len(ref.cooking_methods),
    }


@router.post("/recipes/parse")
def parse_recipe(request: AnalyzeRequest) -> dict:
    if not request.recipe:
        raise HTTPException(status_code=422, detail="`recipe` text is required")
    parsed, source = _analyzer.parser.parse(request.recipe, _analyzer.ref)
    ref = _analyzer.ref
    preview = []
    for item in parsed.ingredients:
        m = matcher.match_ingredient(item.food, ref)
        preview.append({
            "raw_text": item.raw_text,
            "food": item.food,
            "quantity": item.quantity,
            "unit": item.unit,
            "match": m.model_dump(),
        })
    return {
        "parsed": parsed.model_dump(),
        "parse_source": source,
        "matches": preview,
        "needs_confirmation": [p["raw_text"] for p in preview
                               if p["match"]["needs_confirmation"]],
        "cache_key": parsed_hash(parsed),
    }


@router.post("/recipes/analyze", response_model=AnalysisResponse)
def analyze_recipe(request: AnalyzeRequest) -> AnalysisResponse:
    try:
        return _analyzer.analyze(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/ingredients/search")
def search_ingredients(q: str = Query(..., min_length=1), limit: int = 10) -> dict:
    return {"query": q, "results": matcher.search(q, _analyzer.ref, limit=limit)}


@router.get("/ingredients/{ingredient_id}")
def get_ingredient(ingredient_id: str) -> dict:
    ing = _analyzer.ref.get(ingredient_id)
    if ing is None:
        raise HTTPException(status_code=404, detail="Unknown ingredient")
    return {
        "id": ing.id, "name": ing.name, "category": ing.category, "state": ing.state,
        "per_100g": ing.per100g.model_dump(), "refuse_pct": ing.refuse_pct,
        "cooked_yield": ing.cooked_yield, "density_g_per_ml": ing.density_g_per_ml,
    }
