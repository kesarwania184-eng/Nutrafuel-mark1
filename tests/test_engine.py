"""Regression tests.

The point of these is not coverage theatre. Each test pins down one of the
failure modes the original design would have shipped.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.repository import load_reference_data
from app.schemas import AnalyzeRequest, QuantityKind
from app.services import matcher, nutrition
from app.services.converter import convert
from app.services.parser import RuleBasedParser
from app.services.pipeline import RecipeAnalyzer

ref = load_reference_data()
analyzer = RecipeAnalyzer()
client = TestClient(app)

CURRY = ("I made chicken curry using 500g chicken breast, 2 medium onions, 3 tomatoes, "
         "2 tbsp sunflower oil, turmeric, coriander powder, chili powder and cooked it "
         "for about 30 minutes. It serves 4 people.")


# --- parsing --------------------------------------------------------------- #

def test_parses_the_reference_recipe():
    parsed = RuleBasedParser().parse(CURRY, ref)
    foods = [i.food.lower() for i in parsed.ingredients]
    assert any("chicken" in f for f in foods)
    assert any("onion" in f for f in foods)
    assert parsed.servings == 4
    assert parsed.cook_time_min == 30
    assert parsed.method == "curry"


def test_parses_glued_units_and_fractions():
    parsed = RuleBasedParser().parse("250g paneer, 1/2 cup curd, 1.5 tsp salt", ref)
    by_food = {i.food.lower(): i for i in parsed.ingredients}
    assert by_food["paneer"].quantity == 250
    assert by_food["paneer"].unit == "g"
    assert by_food["curd"].quantity == 0.5
    assert by_food["salt"].quantity == 1.5


# --- matching -------------------------------------------------------------- #

def test_generic_oil_is_unresolved_in_analysis():
    res = analyzer.analyze(AnalyzeRequest(recipe="200g potato, 2 tbsp oil", method_override="sauteed"))
    assert "oil" in [x.raw_text.lower() for x in res.unresolved] or any(
        x.ingredient_id is None for x in res.ingredients if x.raw_text.lower().endswith("oil")
    )


def test_alias_solves_what_fuzzy_cannot():
    """The original spec expected RapidFuzz to map shimla mirch -> bell pepper."""
    from rapidfuzz import fuzz
    assert fuzz.token_set_ratio("shimla mirch", "bell pepper") < 30  # fuzzy is hopeless here
    assert matcher.match_ingredient("shimla mirch", ref).ingredient_id == "capsicum"
    assert matcher.match_ingredient("Capsicum", ref).ingredient_id == "capsicum"


def test_typos_fall_through_to_fuzzy():
    m = matcher.match_ingredient("tomatos", ref)
    assert m.ingredient_id == "tomato"


def test_unknown_ingredient_is_flagged_not_guessed():
    m = matcher.match_ingredient("zarzuela de mariscos", ref)
    assert m.ingredient_id is None
    assert m.needs_confirmation


# --- unit conversion ------------------------------------------------------- #

def test_cup_is_food_specific():
    rice = convert(1, "cup", ref.get("rice_white_raw"), ref).edible_g
    milk = convert(1, "cup", ref.get("milk_whole"), ref).edible_g
    dhania = convert(1, "cup", ref.get("coriander_leaves"), ref).edible_g
    assert rice == 185 and milk == 245
    assert dhania < 20  # a global 240 g/cup would be 15x wrong here


def test_refuse_factor_applied():
    c = convert(2, "medium", ref.get("onion"), ref)
    assert c.gross_g == 220
    assert c.edible_g == pytest.approx(198)


def test_volume_uses_density():
    c = convert(250, "ml", ref.get("milk_whole"), ref)
    assert c.edible_g == pytest.approx(257.5)


def test_cooked_entry_converted_to_raw_equivalent():
    """A cup of cooked rice against a raw-rice row is a 2.6x overcount."""
    res = analyzer.analyze(AnalyzeRequest(recipe="1 cup cooked rice"))
    assert res.total_nutrition.kcal < 300


# --- physics --------------------------------------------------------------- #

def test_water_loss_does_not_change_calories():
    raw = analyzer.analyze(AnalyzeRequest(recipe="200g chicken breast", method_override="raw"))
    grilled = analyzer.analyze(AnalyzeRequest(recipe="200g chicken breast", method_override="grilled"))
    assert raw.total_nutrition.kcal == grilled.total_nutrition.kcal
    assert grilled.estimated_cooked_weight_g < 200  # mass leaves, energy does not


def test_itemised_oil_is_not_double_counted():
    plain = analyzer.analyze(AnalyzeRequest(
        recipe="200g potato, 2 tbsp sunflower oil", method_override="sauteed"))
    fried = analyzer.analyze(AnalyzeRequest(
        recipe="200g potato, 2 tbsp sunflower oil", method_override="deep_fried"))
    # Deep frying must not simply add absorbed oil on top of the oil we were told about.
    assert fried.total_nutrition.fat_g <= plain.total_nutrition.fat_g


def test_unitemised_deep_fry_adds_absorbed_oil():
    res = analyzer.analyze(AnalyzeRequest(recipe="200g potato", method_override="deep_fried"))
    assert res.total_nutrition.fat_g > 10


def test_draining_removes_sodium_not_energy():
    boiled = analyzer.analyze(AnalyzeRequest(recipe="100g spinach", method_override="boiled"))
    raw = analyzer.analyze(AnalyzeRequest(recipe="100g spinach", method_override="raw"))
    assert boiled.total_nutrition.sodium_mg < raw.total_nutrition.sodium_mg
    assert boiled.total_nutrition.kcal == raw.total_nutrition.kcal


# --- end to end ------------------------------------------------------------ #

def test_reference_recipe_end_to_end():
    res = analyzer.analyze(AnalyzeRequest(recipe=CURRY))
    assert res.servings == 4
    assert 800 < res.total_nutrition.kcal < 1400
    assert 100 < res.total_nutrition.protein_g < 130
    assert res.per_serving.kcal == pytest.approx(res.total_nutrition.kcal / 4, rel=0.02)
    assert 40 <= res.confidence.overall <= 99


def test_sodium_confidence_is_lower_when_salt_is_missing():
    res = analyzer.analyze(AnalyzeRequest(recipe=CURRY))
    assert res.confidence.sodium < res.confidence.energy_macros
    assert any("salt" in s.lower() for s in res.confidence.suggestions)


def test_precise_input_scores_higher_than_vague_input():
    precise = analyzer.analyze(AnalyzeRequest(
        recipe="500g chicken breast, 200g onion, 30g sunflower oil", method_override="curry"))
    vague = analyzer.analyze(AnalyzeRequest(
        recipe="some chicken, some onion, some oil", method_override="curry"))
    assert precise.confidence.energy_macros > vague.confidence.energy_macros


def test_macros_explain_the_calories():
    res = analyzer.analyze(AnalyzeRequest(recipe=CURRY))
    ok, _ = nutrition.atwater_check(res.total_nutrition)
    assert ok


def test_determinism():
    a = analyzer.analyze(AnalyzeRequest(recipe=CURRY)).total_nutrition
    b = analyzer.analyze(AnalyzeRequest(recipe=CURRY)).total_nutrition
    assert a == b


def test_every_ingredient_explains_itself():
    res = analyzer.analyze(AnalyzeRequest(recipe=CURRY))
    for item in res.ingredients:
        assert item.conversion_basis
        assert item.match_method is not None


# --- api ------------------------------------------------------------------- #

def test_health_endpoint():
    r = client.get("/v1/health")
    assert r.status_code == 200 and r.json()["ingredients"] > 50


def test_parse_then_analyze_round_trip():
    parsed = client.post("/v1/recipes/parse", json={"recipe": CURRY}).json()
    analyzed = client.post("/v1/recipes/analyze", json={"parsed": parsed["parsed"]})
    assert analyzed.status_code == 200
    assert analyzed.json()["parse_source"] == "client"


def test_search_endpoint():
    r = client.get("/v1/ingredients/search", params={"q": "pyaz"})
    assert any(x["ingredient_id"] == "onion" for x in r.json()["results"])
