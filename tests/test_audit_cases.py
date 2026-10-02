import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import AnalyzeRequest
from app.services.pipeline import RecipeAnalyzer
from app.services.parser import RuleBasedParser
from app.repository import load_reference_data

ref = load_reference_data()
analyzer = RecipeAnalyzer()
client = TestClient(app)


def test_basic_reference_recipe():
    text = "I made chicken curry using 500g chicken breast, 2 medium onions, 3 tomatoes, 2 tbsp sunflower oil, turmeric, coriander powder and chili powder. It serves 4 people."
    result = analyzer.analyze(AnalyzeRequest(recipe=text, method_override="curry", servings_override=4))
    assert result.servings == 4
    assert result.total_nutrition.kcal > 0
    assert result.total_nutrition.protein_g > 0
    assert len(result.ingredients) > 0


def test_generic_oil_does_not_silently_resolve():
    result = analyzer.analyze(AnalyzeRequest(recipe="200g potato, 2 tbsp oil", method_override="sauteed"))
    assert any(i.ingredient_id is None for i in result.ingredients if i.raw_text.lower().endswith("oil")) or any("oil" in x.lower() for x in result.unresolved)


def test_specific_oil_resolves():
    result = analyzer.analyze(AnalyzeRequest(recipe="200g potato, 2 tbsp sunflower oil", method_override="sauteed"))
    oil_items = [i for i in result.ingredients if "oil" in i.raw_text.lower()]
    assert oil_items
    assert any(i.ingredient_id is not None for i in oil_items)


def test_servings_only_changes_per_serving_not_total():
    recipe = "500g chicken breast, 2 onions, 2 tbsp sunflower oil"
    one = analyzer.analyze(AnalyzeRequest(recipe=recipe, method_override="curry", servings_override=1))
    four = analyzer.analyze(AnalyzeRequest(recipe=recipe, method_override="curry", servings_override=4))
    assert four.total_nutrition.kcal == pytest.approx(one.total_nutrition.kcal, rel=1e-9)
    assert four.per_serving.kcal == pytest.approx(one.per_serving.kcal / 4, abs=0.5)


def test_dish_name_is_not_an_ingredient():
    parsed = RuleBasedParser().parse("Chicken curry: 500g chicken breast, 2 medium onions, 2 tbsp oil", ref)
    assert parsed.dish_name and parsed.dish_name.lower() == "chicken curry"
    assert all(i.raw_text.lower() != "chicken curry" for i in parsed.ingredients)


def test_dish_preamble_is_not_an_ingredient():
    parsed = RuleBasedParser().parse("Chicken curry using 500g chicken breast, 2 onions, 3 tomatoes", ref)
    assert all(i.raw_text.lower() != "chicken curry" for i in parsed.ingredients)


@pytest.mark.parametrize("text", [
    "500g chicken breast", "0.5 kg chicken breast", "2 tbsp sunflower oil",
    "1 cup rice", "2 medium onions", "1/2 tsp turmeric", "200 grams potato",
])
def test_common_quantities_and_units(text):
    parsed = RuleBasedParser().parse(text, ref)
    assert parsed.ingredients
    item = parsed.ingredients[0]
    assert item.quantity is not None and item.quantity > 0


def test_missing_quantities_are_not_invented():
    parsed = RuleBasedParser().parse("chicken breast, onions, tomatoes, sunflower oil", ref)
    assert parsed.ingredients
    assert all(i.quantity is None for i in parsed.ingredients)


def test_ambiguous_input_is_not_falsely_precise():
    result = analyzer.analyze(AnalyzeRequest(recipe="500g chicken, 2 onions, oil", method_override="curry"))
    assert result.warnings or result.unresolved or any(i.needs_confirmation for i in result.ingredients)


@pytest.mark.parametrize("method", ["curry", "sauteed", "grilled", "boiled"])
def test_supported_cooking_methods_return_valid_analysis(method):
    result = analyzer.analyze(AnalyzeRequest(recipe="200g chicken breast", method_override=method))
    assert result.method == method
    assert result.total_nutrition.kcal > 0
    assert result.estimated_cooked_weight_g > 0


def test_itemised_oil_is_not_double_counted_in_deep_fry():
    sauteed = analyzer.analyze(AnalyzeRequest(recipe="200g potato, 2 tbsp sunflower oil", method_override="sauteed"))
    fried = analyzer.analyze(AnalyzeRequest(recipe="200g potato, 2 tbsp sunflower oil", method_override="deep_fried"))
    assert fried.total_nutrition.fat_g <= sauteed.total_nutrition.fat_g


def test_water_loss_preserves_energy():
    raw = analyzer.analyze(AnalyzeRequest(recipe="200g chicken breast", method_override="raw"))
    grilled = analyzer.analyze(AnalyzeRequest(recipe="200g chicken breast", method_override="grilled"))
    assert grilled.total_nutrition.kcal == raw.total_nutrition.kcal
    assert grilled.estimated_cooked_weight_g < raw.estimated_cooked_weight_g


def test_unknown_ingredient_is_handled_without_crashing():
    response = client.post("/v1/recipes/analyze", json={"recipe":"300g dragon fruit, 100g quinoa, 1 tbsp sunflower oil"})
    assert response.status_code in (200, 422)
    if response.status_code == 200:
        body = response.json()
        assert body["unresolved"] or body["warnings"] or any(i["needs_confirmation"] for i in body["ingredients"])


@pytest.mark.parametrize("text", ["hello", "asdfghjkl"])
def test_invalid_semantic_input_does_not_500(text):
    response = client.post("/v1/recipes/analyze", json={"recipe": text})
    assert response.status_code != 500


def test_empty_input_is_rejected():
    response = client.post("/v1/recipes/parse", json={"recipe":"   "})
    assert response.status_code == 422


def test_parse_then_analyze_api_round_trip():
    parsed = client.post("/v1/recipes/parse", json={"recipe":"500g chicken breast, 2 onions, 2 tbsp sunflower oil"})
    assert parsed.status_code == 200
    analyzed = client.post("/v1/recipes/analyze", json={"parsed":parsed.json()["parsed"]})
    assert analyzed.status_code == 200
    assert analyzed.json()["parse_source"] == "client"


def test_search_and_unknown_ingredient_endpoints():
    search = client.get("/v1/ingredients/search", params={"q":"pyaz"})
    assert search.status_code == 200
    unknown = client.get("/v1/ingredients/definitely-not-an-id")
    assert unknown.status_code == 404


def test_search_limit_is_bounded():
    response = client.get("/v1/ingredients/search", params={"q":"oil", "limit":0})
    assert response.status_code == 422


def test_analysis_is_deterministic():
    text = "500g chicken breast, 2 onions, 2 tbsp sunflower oil"
    first = analyzer.analyze(AnalyzeRequest(recipe=text, method_override="curry"))
    second = analyzer.analyze(AnalyzeRequest(recipe=text, method_override="curry"))
    assert first.total_nutrition == second.total_nutrition
    assert first.ingredients == second.ingredients
