"""Ingredient name resolution.

Order matters, and it is the opposite of what the original spec assumed:

    1. exact canonical name
    2. curated alias table   <- this is what solves "shimla mirch" -> capsicum
    3. token-set fuzzy match <- only fixes typos and word-order, never synonyms
    4. unresolved            <- ask the user, never guess

Fuzzy matching cannot bridge synonyms. "Shimla Mirch" and "Bell Pepper" have a
token-set ratio near zero. Any design that leans on RapidFuzz for translation
will silently drop ingredients or match the wrong one.
"""

from __future__ import annotations

from app.repository import ReferenceData, normalize
from app.schemas import IngredientMatch, MatchMethod

try:  # pragma: no cover - trivial import guard
    from rapidfuzz import fuzz, process

    _HAS_RAPIDFUZZ = True
except ImportError:  # pragma: no cover
    import difflib

    _HAS_RAPIDFUZZ = False

AUTO_ACCEPT = 90.0
CONFIRM_FLOOR = 70.0

# Generic category terms remain unresolved when several specific ingredients
# exist. Token-set fuzzy matching would otherwise score "oil" as a perfect match
# for entries such as "Sunflower Oil".
GENERIC_AMBIGUOUS = {
    "oil",
    "cooking oil",
    "edible oil",
    "vegetable oil",
    "refined oil",
}

# Words that carry preparation state, not identity. Stripped before matching but
# kept by the caller as qualifiers.
_PREP_WORDS = {
    "chopped", "finely", "sliced", "diced", "grated", "minced", "crushed",
    "boiled", "cooked", "raw", "fresh", "dried", "roasted", "fried", "ground",
    "powdered", "powder", "paste", "medium", "large", "small", "whole", "half",
    "of", "the", "a", "an", "some", "few",
}


def _strip_prep(text: str) -> str:
    tokens = [t for t in normalize(text).split() if t not in _PREP_WORDS]
    return " ".join(tokens) or normalize(text)


def _fuzzy(query: str, choices: dict[str, str]) -> tuple[str | None, float]:
    """choices: normalized_name -> ingredient_id. Returns (ingredient_id, score)."""
    if not choices:
        return None, 0.0
    if _HAS_RAPIDFUZZ:
        hit = process.extractOne(query, list(choices.keys()), scorer=fuzz.token_set_ratio)
        if hit:
            return choices[hit[0]], float(hit[1])
        return None, 0.0
    best = difflib.get_close_matches(query, list(choices.keys()), n=1, cutoff=0.0)
    if not best:
        return None, 0.0
    score = difflib.SequenceMatcher(None, query, best[0]).ratio() * 100
    return choices[best[0]], score


def match_ingredient(name: str, ref: ReferenceData) -> IngredientMatch:
    raw = name or ""
    stripped = _strip_prep(raw)
    normalized = normalize(raw)

    if normalized in GENERIC_AMBIGUOUS:
        pool: dict[str, str] = {**ref.by_normalized_name, **ref.aliases}
        return IngredientMatch(
            query=raw,
            method=MatchMethod.UNRESOLVED,
            score=0.0,
            needs_confirmation=True,
            candidates=_top_candidates(normalized, pool, ref),
        )

    for probe in (normalized, stripped):
        if probe in ref.by_normalized_name:
            ing = ref.ingredients[ref.by_normalized_name[probe]]
            return IngredientMatch(
                query=raw, ingredient_id=ing.id, matched_name=ing.name,
                method=MatchMethod.EXACT, score=100.0,
            )

    for probe in (normalized, stripped):
        if probe in ref.aliases:
            ing = ref.ingredients[ref.aliases[probe]]
            return IngredientMatch(
                query=raw, ingredient_id=ing.id, matched_name=ing.name,
                method=MatchMethod.ALIAS, score=100.0,
            )

    pool: dict[str, str] = {**ref.by_normalized_name, **ref.aliases}
    ing_id, score = _fuzzy(stripped, pool)
    if ing_id and score >= CONFIRM_FLOOR:
        ing = ref.ingredients[ing_id]
        return IngredientMatch(
            query=raw,
            ingredient_id=ing.id,
            matched_name=ing.name,
            method=MatchMethod.FUZZY,
            score=round(score, 1),
            needs_confirmation=score < AUTO_ACCEPT,
            candidates=_top_candidates(stripped, pool, ref, exclude=ing.id),
        )

    return IngredientMatch(
        query=raw,
        method=MatchMethod.UNRESOLVED,
        score=round(score, 1) if ing_id else 0.0,
        needs_confirmation=True,
        candidates=_top_candidates(stripped, pool, ref),
    )


def _top_candidates(
    query: str, pool: dict[str, str], ref: ReferenceData, exclude: str | None = None, n: int = 3
) -> list[dict]:
    if not _HAS_RAPIDFUZZ:  # pragma: no cover
        return []
    hits = process.extract(query, list(pool.keys()), scorer=fuzz.token_set_ratio, limit=n + 3)
    out, seen = [], set()
    for text, score, _ in hits:
        ing_id = pool[text]
        if ing_id == exclude or ing_id in seen:
            continue
        seen.add(ing_id)
        out.append({
            "ingredient_id": ing_id,
            "name": ref.ingredients[ing_id].name,
            "score": round(float(score), 1),
        })
        if len(out) >= n:
            break
    return out


def search(query: str, ref: ReferenceData, limit: int = 10) -> list[dict]:
    """Typeahead for the manual-correction UI."""
    pool: dict[str, str] = {**ref.by_normalized_name, **ref.aliases}
    return _top_candidates(normalize(query), pool, ref, n=limit)
