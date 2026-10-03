import { describe, expect, it } from "vitest";
import {
  estimateIngredientNutrition,
  ingredientWeightGrams,
  parseRecipe,
  parseServings,
} from "./recipe";

describe("recipe parsing and estimates", () => {
  it("parses titles, mixed fractions, ingredient lines, and common serving labels", () => {
    const recipe = parseRecipe(
      "Banana oats\nMakes 2 servings\n1 1/2 cups rolled oats\n½ banana\nInstructions:\nMix and serve"
    );
    expect(recipe.title).toBe("Banana oats");
    expect(recipe.servings).toBe(2);
    expect(recipe.ingredients.map(item => item.quantity)).toEqual([1.5, 0.5]);
    expect(recipe.ingredients[0]?.ingredient).toBe("rolled oats");
  });

  it("supports unicode and slash fractions while rejecting implausible servings", () => {
    expect(parseServings("Serves 1/2")).toBe(0.5);
    expect(parseServings("Yield: ⅔")).toBe(2 / 3);
    expect(parseServings("Serves 0")).toBe(1);
    expect(parseServings("Makes 400 servings")).toBe(1);
  });

  it("keeps combined Unicode quantities and marks recognized ingredient types specifically", () => {
    const recipe = parseRecipe(
      "Oats\n1½ cups rolled oats\n1 tbsp olive oil\n2 tbsp oil for frying"
    );
    expect(recipe.ingredients.map(item => item.quantity)).toEqual([1.5, 1, 2]);
    expect(recipe.ingredients.map(item => item.ambiguous)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("flags generic oil and does not claim its nutrition type is known", () => {
    const recipe = parseRecipe("Salad\nServes 1\n2 tbsp oil");
    expect(recipe.ingredients[0]?.ambiguous).toBe(true);
    expect(estimateIngredientNutrition("rolled oats", 50).known).toBe(true);
    expect(estimateIngredientNutrition("mystery ingredient", 50).known).toBe(
      false
    );
    expect(estimateIngredientNutrition("mystery ingredient", 50).calories).toBe(
      0
    );
  });

  it("uses food-aware household measures instead of one generic cup conversion", () => {
    expect(ingredientWeightGrams("rolled oats", 1, "cup")).toBe(80);
    expect(ingredientWeightGrams("whole milk", 1, "cup")).toBe(240);
    expect(ingredientWeightGrams("egg", 1, "")).toBe(50);
    expect(ingredientWeightGrams("salt", 1, "pinch")).toBeCloseTo(0.36);
  });

  it("ignores instruction prose as ingredients and handles empty input", () => {
    expect(parseRecipe("").ingredients).toEqual([]);
    const recipe = parseRecipe(
      "Simple eggs\n2 eggs\nInstructions:\nMix ingredients and bake for 10 minutes"
    );
    expect(recipe.ingredients).toHaveLength(1);
  });
});
