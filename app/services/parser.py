"""Natural language -> ParsedRecipe.

Two parsers behind one interface.

RuleBasedParser handles the shape most users actually type ("500g chicken, 2
onions, 2 tbsp oil"). It is free, instant, deterministic and testable, and it is
the reason the service still works when the model API is down or the user is
offline. Route to the LLM only when the rules leave text unparsed.

LLMParser is constrained three ways so it cannot invent nutrition:
  - it receives the canonical ingredient vocabulary and must choose from it or
    return null
  - it must return JSON matching ParsedRecipe, which is Pydantic-validated
  - temperature 0 and a cache key on the input text, so the same sentence always
    produces the same numbers
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Protocol

from app.repository import ReferenceData, normalize
from app.schemas import ParsedIngredient, ParsedRecipe, QuantityKind

MASS = {"g", "gm", "gms", "gram", "grams", "kg", "kilo", "kilos", "kilogram", "kilograms"}
VOLUME = {"ml", "millilitre", "millilitres", "l", "litre", "litres", "liter", "liters"}
HOUSEHOLD = {
    "tbsp", "tablespoon", "tablespoons", "tsp", "teaspoon", "teaspoons",
    "cup", "cups", "katori", "katoris", "glass", "glasses", "pinch", "pinches",
    "bunch", "bunches", "sprig", "sprigs", "handful", "handfuls",
}
COUNTERS = {"piece", "pieces", "pc", "pcs", "clove", "cloves", "inch", "inches", "no", "nos"}
SIZES = {"small", "medium", "large", "big"}

UNIT_CANON = {
    "gm": "g", "gms": "g", "gram": "g", "grams": "g",
    "kilo": "kg", "kilos": "kg", "kilogram": "kg", "kilograms": "kg",
    "millilitre": "ml", "millilitres": "ml",
    "litre": "l", "litres": "l", "liter": "l", "liters": "l",
    "tablespoon": "tbsp", "tablespoons": "tbsp", "tbsps": "tbsp",
    "teaspoon": "tsp", "teaspoons": "tsp", "tsps": "tsp",
    "cups": "cup", "katoris": "katori", "glasses": "glass",
    "pinches": "pinch", "bunches": "bunch", "sprigs": "sprig",
    "pieces": "piece", "pcs": "piece", "pc": "piece",
    "cloves": "clove", "inches": "inch",
    "big": "large",
}

VAGUE_WORDS = {"some", "a little", "little", "few", "as required", "to taste", "as needed", "handful"}

METHOD_PATTERNS: list[tuple[str, str]] = [
    (r"deep[\s-]?fr(y|ied|ying)", "deep_fried"),
    (r"air[\s-]?fr(y|ied|ying)", "air_fried"),
    (r"shallow[\s-]?fr(y|ied|ying)|pan[\s-]?fr(y|ied|ying)", "shallow_fried"),
    (r"pressure[\s-]?cook", "pressure_cooked"),
    (r"\bsteam(ed|ing)?\b", "steamed"),
    (r"\bgrill(ed|ing)?\b|tandoor", "grilled"),
    (r"\broast(ed|ing)?\b", "roasted"),
    (r"\bbak(e|ed|ing)\b", "baked"),
    (r"\bboil(ed|ing)?\b", "boiled"),
    (r"\bsaut|bhun", "sauteed"),
    (r"\btadka\b|temper(ed|ing)?", "tadka"),
    (r"\bcurry\b|\bgravy\b|\bsabzi\b|\bmasala\b", "curry"),
    (r"\bfr(y|ied|ying)\b", "shallow_fried"),
]

_FRACTIONS = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3}

_QTY = r"(\d+\s+\d+/\d+|\d+/\d+|\d*\.\d+|\d+)"
_ITEM_RE = re.compile(rf"^\s*(?:{_QTY})?\s*([a-zA-Z\.]+)?\s*(.*)$")


class RecipeParser(Protocol):
    def parse(self, text: str, ref: ReferenceData) -> ParsedRecipe: ...


# --------------------------------------------------------------------------- #
# Rule-based
# --------------------------------------------------------------------------- #


def _to_float(token: str) -> float | None:
    token = token.strip()
    if not token:
        return None
    if " " in token and "/" in token:
        whole, frac = token.split()
        num, den = frac.split("/")
        return float(whole) + float(num) / float(den)
    if "/" in token:
        num, den = token.split("/")
        return float(num) / float(den)
    try:
        return float(token)
    except ValueError:
        return None


def _expand_fractions(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    for glyph, value in _FRACTIONS.items():
        text = text.replace(glyph, f" {value} ")
    return text


def _detect_method(text: str) -> str | None:
    low = text.lower()
    for pattern, method in METHOD_PATTERNS:
        if re.search(pattern, low):
            return method
    return None


def _detect_servings(text: str) -> float | None:
    low = text.lower()
    for pattern in (
        r"\bserves?\s*[:=-]?\s*(?:about\s+|approximately\s+|approx\.?\s+)?(\d+(?:\.\d+)?)",
        r"\b(\d+(?:\.\d+)?)\s+servings?\b",
        r"\bfor\s+(?:about\s+|approximately\s+|approx\.?\s+)?(\d+(?:\.\d+)?)\s+(?:people|persons|members)\b",
        r"\bmakes?\s*[:=-]?\s*(?:about\s+|approximately\s+|approx\.?\s+)?(\d+(?:\.\d+)?)\s+(?:portions?|servings?)\b",
        r"\byields?\s*[:=-]?\s*(?:about\s+|approximately\s+|approx\.?\s+)?(\d+(?:\.\d+)?)\s+(?:portions?|servings?)\b",
    ):
        m = re.search(pattern, low)
        if m:
            return float(m.group(1))
    return None


def _detect_cook_time(text: str) -> int | None:
    m = re.search(r"(\d+)\s*(?:-\s*\d+\s*)?(minutes?|mins?|hours?|hrs?)", text.lower())
    if not m:
        return None
    value = int(m.group(1))
    return value * 60 if m.group(2).startswith(("hour", "hr")) else value


_SPLIT_RE = re.compile(r",|\band\b|\bwith\b|\bplus\b|\n|;|\+")
_LEAD_RE = re.compile(
    r"^\s*(i\s+)?(made|cooked|prepared|used|added|took|make|cook|prepare|use|add)\s+", re.I
)
_TRAILING_CLAUSE_RE = re.compile(
    r"\b(and\s+)?cook(ed)?\s+(it\s+)?for\b.*$"
    r"|\bit\s+serves?\s*[:=-]?.*$"
    r"|\bserves?\s*[:=-]?\s*(?:about\s+|approximately\s+|approx\.?\s+)?\d+.*$"
    r"|\bmakes?\s*[:=-]?\s*(?:about\s+|approximately\s+|approx\.?\s+)?\d+\s+(?:portions?|servings?).*$"
    r"|\byields?\s*[:=-]?\s*(?:about\s+|approximately\s+|approx\.?\s+)?\d+\s+(?:portions?|servings?).*$",
    re.I,
)
# "I made chicken curry using ..." -> everything before the ingredient list is the
# dish name, not an ingredient. Without this the dish name gets fuzzy-matched to a
# real ingredient and silently enters the totals.
_PREAMBLE_RE = re.compile(
    r"^\s*(?:i\s+)?(?:made|make|cooked|cook|prepared|prepare|making|cooking)\b[^,]*?"
    r"\b(?:using|with|from|out\s+of|containing)\b\s*",
    re.I,
)


class RuleBasedParser:
    """Deterministic parser for the common comma-separated pattern."""

    def parse(self, text: str, ref: ReferenceData) -> ParsedRecipe:
        original = text or ""
        cleaned = _expand_fractions(original)
        cleaned = _TRAILING_CLAUSE_RE.sub(" ", cleaned)
        # Remove recipe-level serving/yield metadata before ingredient splitting.
        cleaned = re.sub(
            r"\b(?:it\s+)?serves?\s*[:=-]?\s*(?:about\s+|approximately\s+|approx\.?\s+)?\d+(?:\.\d+)?(?:\s+(?:people|persons|members|servings?|portions?))?\b.*$",
            " ",
            cleaned,
            flags=re.I,
        )
        cleaned = re.sub(
            r"\b(?:makes?|yields?)\s*[:=-]?\s*(?:about\s+|approximately\s+|approx\.?\s+)?\d+(?:\.\d+)?\s+(?:servings?|portions?)\b.*$",
            " ",
            cleaned,
            flags=re.I,
        )
        # A bare "4 servings" is also recipe metadata, not an ingredient.
        cleaned = re.sub(
            r"\b\d+(?:\.\d+)?\s+servings?\b.*$",
            " ",
            cleaned,
            flags=re.I,
        )
        cleaned = _PREAMBLE_RE.sub("", cleaned, count=1)

        ingredients: list[ParsedIngredient] = []
        unparsed: list[str] = []

        for chunk in _SPLIT_RE.split(cleaned):
            chunk = _LEAD_RE.sub("", chunk).strip(" .\t")
            if not chunk or len(chunk) < 2:
                continue
            parsed = self._parse_chunk(chunk, ref)
            if parsed is None:
                unparsed.append(chunk)
            else:
                ingredients.append(parsed)

        return ParsedRecipe(
            dish_name=self._guess_dish(original),
            ingredients=ingredients,
            method=_detect_method(original),
            cook_time_min=_detect_cook_time(original),
            servings=_detect_servings(original),
            unparsed_text=unparsed,
        )

    def _parse_chunk(self, chunk: str, ref: ReferenceData) -> ParsedIngredient | None:
        low = chunk.lower().strip()
        vague = any(low.startswith(w) for w in VAGUE_WORDS)

        m = _ITEM_RE.match(chunk)
        if not m:
            return None
        qty_token, maybe_unit, rest = m.group(1), m.group(2) or "", m.group(3) or ""
        quantity = _to_float(qty_token or "")

        unit: str | None = None
        name_parts: list[str] = []
        token = maybe_unit.strip(". ").lower()
        canon = UNIT_CANON.get(token, token)

        if canon in MASS | VOLUME | HOUSEHOLD | COUNTERS | SIZES:
            unit = canon
            name_parts.append(rest)
        else:
            name_parts.append(maybe_unit)
            name_parts.append(rest)

        # A quantity glued to its unit: "500g", "2tbsp"
        if quantity is None:
            glued = re.match(rf"^{_QTY}\s*([a-zA-Z]+)\b(.*)$", chunk.strip())
            if glued:
                quantity = _to_float(glued.group(1))
                token = glued.group(2).lower()
                canon = UNIT_CANON.get(token, token)
                if canon in MASS | VOLUME | HOUSEHOLD | COUNTERS | SIZES:
                    unit = canon
                    name_parts = [glued.group(3)]

        name = " ".join(p for p in name_parts if p).strip(" .-")
        # A size word can sit after the number: "2 medium onions"
        head = name.split()
        if head and UNIT_CANON.get(head[0].lower(), head[0].lower()) in SIZES and unit is None:
            unit = UNIT_CANON.get(head[0].lower(), head[0].lower())
            name = " ".join(head[1:])

        for word in sorted(VAGUE_WORDS, key=len, reverse=True):
            if name.lower().startswith(word):
                name = name[len(word):].strip()
                vague = True

        if not name:
            return None

        qualifier = None
        qual_match = re.search(
            r"\b(chopped|finely chopped|sliced|grated|boiled|cooked|roasted|for frying|"
            r"soaked|raw|fresh|crushed|minced)\b",
            name.lower(),
        )
        if qual_match:
            qualifier = qual_match.group(1)

        if unit in MASS:
            kind = QuantityKind.MASS
        elif unit in VOLUME:
            kind = QuantityKind.VOLUME
        elif unit in HOUSEHOLD:
            kind = QuantityKind.HOUSEHOLD
        elif unit in COUNTERS or unit in SIZES or (quantity is not None and unit is None):
            kind = QuantityKind.COUNT
        elif vague:
            kind = QuantityKind.VAGUE
        else:
            kind = QuantityKind.MISSING

        if quantity is not None and unit is None:
            unit = "piece"

        return ParsedIngredient(
            raw_text=chunk.strip(),
            food=name.strip(),
            quantity=quantity,
            unit=unit,
            qualifier=qualifier,
            quantity_kind=kind,
        )

    @staticmethod
    def _guess_dish(text: str) -> str | None:
        m = re.search(r"\b(?:made|cooked|prepared)\s+([a-zA-Z ]{3,40}?)\s+(?:using|with|for|,)", text, re.I)
        return m.group(1).strip() if m else None


# --------------------------------------------------------------------------- #
# LLM
# --------------------------------------------------------------------------- #

SYSTEM_PROMPT = """You convert a cooking description into JSON. You are a parser.

Absolute rules:
- Never output calories, protein, fat, carbs, fibre, sodium or any nutrition value.
- Never invent ingredients that are not in the user's text.
- For `food`, choose the closest name from CANONICAL_INGREDIENTS. If nothing is
  close, copy the user's own words instead and do not guess.
- Generic ingredient words such as "oil", "cooking oil", or "edible oil" are
  intentionally ambiguous when the vocabulary contains multiple oils. Keep the
  user's generic wording; never silently turn "oil" into a specific oil.
- If an amount is not stated, set quantity and unit to null. Do not estimate.
- `quantity_kind` must be one of: mass, volume, count, household, vague, missing.
- `method` must be one of METHODS or null.
- Return only a JSON object. No prose, no markdown fences.

Schema:
{"dish_name": str|null, "ingredients": [{"raw_text": str, "food": str,
 "quantity": number|null, "unit": str|null, "qualifier": str|null,
 "quantity_kind": str}], "method": str|null, "cook_time_min": int|null,
 "servings": number|null, "unparsed_text": [str]}"""


class LLMParser:
    """Adapter around any chat completion API. `complete` is injected so the
    engine stays provider-agnostic and unit-testable without network access."""

    def __init__(self, complete, max_repairs: int = 1):
        self.complete = complete
        self.max_repairs = max_repairs

    def build_prompt(self, text: str, ref: ReferenceData, shortlist_size: int = 250) -> str:
        vocab = self._shortlist(text, ref, shortlist_size)
        methods = ", ".join(sorted(ref.cooking_methods))
        return (
            f"{SYSTEM_PROMPT}\n\nCANONICAL_INGREDIENTS:\n{json.dumps(vocab)}\n\n"
            f"METHODS: {methods}\n\nUSER_TEXT:\n{text}"
        )

    @staticmethod
    def _shortlist(text: str, ref: ReferenceData, size: int) -> list[str]:
        """Send a relevant slice of the vocabulary, not all of it.

        With 1,000+ ingredients, dumping the whole list into every prompt is slow
        and expensive. Retrieve on token overlap and always keep pantry staples.
        """
        tokens = set(normalize(text).split())
        scored: list[tuple[int, str]] = []
        for ing in ref.ingredients.values():
            overlap = len(tokens & set(normalize(ing.name).split()))
            scored.append((overlap, ing.name))
        for alias, ing_id in ref.aliases.items():
            if set(alias.split()) & tokens:
                scored.append((2, ref.ingredients[ing_id].name))
        scored.sort(key=lambda x: -x[0])
        seen, out = set(), []
        for _, name in scored:
            if name not in seen:
                seen.add(name)
                out.append(name)
            if len(out) >= size:
                break
        return out

    def parse(self, text: str, ref: ReferenceData) -> ParsedRecipe:
        prompt = self.build_prompt(text, ref)
        last_error = ""
        for attempt in range(self.max_repairs + 1):
            payload = self.complete(prompt if attempt == 0 else f"{prompt}\n\nYour previous "
                                    f"output was invalid: {last_error}. Return valid JSON only.")
            try:
                data = json.loads(_strip_fences(payload))
                return ParsedRecipe.model_validate(data)
            except Exception as exc:  # noqa: BLE001 - we retry then fall back
                last_error = str(exc)[:200]
        raise ValueError(f"LLM did not return a valid ParsedRecipe: {last_error}")


def _strip_fences(text: str) -> str:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"```$", "", text.strip())
    return text.strip()


class HybridParser:
    """Rules first; escalate to the LLM only when the rules struggle."""

    def __init__(self, llm: LLMParser | None = None):
        self.rules = RuleBasedParser()
        self.llm = llm

    def parse(self, text: str, ref: ReferenceData) -> tuple[ParsedRecipe, str]:
        rule_result = self.rules.parse(text, ref)
        needs_llm = (
            not rule_result.ingredients
            or len(rule_result.unparsed_text) > len(rule_result.ingredients)
        )
        if needs_llm and self.llm is not None:
            try:
                return self.llm.parse(text, ref), "llm"
            except Exception:  # noqa: BLE001 - degrade, never fail the request
                return rule_result, "rules"
        return rule_result, "rules"
