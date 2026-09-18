"""Console walkthrough of the engine, including the cases the original design
would have got wrong."""

from app.schemas import AnalyzeRequest
from app.services.pipeline import RecipeAnalyzer

analyzer = RecipeAnalyzer()

EXAMPLES = [
    ("Reference recipe from the spec",
     "I made chicken curry using 500g chicken breast, 2 medium onions, 3 tomatoes, "
     "2 tbsp sunflower oil, turmeric, coriander powder, chili powder and cooked it "
     "for about 30 minutes. It serves 4 people.", None),
    ("Hindi ingredient names",
     "1 katori toor dal, 2 pyaz, 3 tamatar, 1 tsp haldi, 1 tbsp ghee, 1 tsp namak, serves 3",
     "curry"),
    ("Cooked-state entry (naive engines overcount 2.6x here)",
     "1 cup cooked rice", None),
    ("Unitemised deep fry (absorbed oil must be added)",
     "300g potato", "deep_fried"),
    ("Itemised oil in a deep fry (must not be double counted)",
     "300g potato, 500 ml sunflower oil", "deep_fried"),
    ("Vague amounts",
     "some chicken, some oil, some onion, serves 2", "curry"),
    ("Unknown ingredient is flagged, never guessed",
     "200g chicken, 100g zarzuela paste", "curry"),
]


def show(title, recipe, method):
    res = analyzer.analyze(AnalyzeRequest(recipe=recipe, method_override=method))
    print("=" * 78)
    print(title)
    print(f"  input: {recipe[:70]}")
    t, s = res.total_nutrition, res.per_serving
    print(f"  total       {t.kcal:>7.0f} kcal  P {t.protein_g:>6.1f}  F {t.fat_g:>6.1f}  "
          f"C {t.carbs_g:>6.1f}  Na {t.sodium_mg:>6.0f} mg")
    print(f"  per serving {s.kcal:>7.0f} kcal  P {s.protein_g:>6.1f}   (servings: {res.servings:g})")
    print(f"  confidence  macros {res.confidence.overall}  sodium {res.confidence.sodium}  "
          f"cooked weight {res.confidence.cooked_weight}")
    for item in res.ingredients:
        name = item.matched_name or f"UNRESOLVED: {item.raw_text}"
        weight = f"{item.edible_weight_g:g} g" if item.edible_weight_g else "-"
        print(f"    {item.raw_text[:26]:28s} -> {name[:26]:28s} {weight:>9s} "
              f"{item.nutrition.kcal:>6.0f} kcal  [{item.match_method.value}]")
    for warn in res.warnings:
        print(f"    ! {warn}")
    for tip in res.confidence.suggestions:
        print(f"    > {tip}")
    print()


if __name__ == "__main__":
    for row in EXAMPLES:
        show(*row)
