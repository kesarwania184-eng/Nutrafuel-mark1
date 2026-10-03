import { useMemo, useState } from "react";
import { ArrowRight, CircleHelp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MealType } from "@shared/nutrition";
import {
  estimateIngredientNutrition,
  ingredientWeightGrams,
  parseRecipe,
  type ParsedIngredient,
  type ParsedRecipe,
} from "@shared/recipe";

const AMBIGUOUS_CHOICES: Record<string, string[]> = {
  oil: ["olive oil", "coconut oil", "vegetable oil"],
  cheese: ["cheddar cheese", "mozzarella cheese", "parmesan cheese"],
  milk: ["whole milk", "skim milk", "oat milk"],
  rice: ["white rice", "brown rice"],
  yogurt: ["Greek yogurt", "plain yogurt"],
  bread: ["whole wheat bread", "white bread", "sourdough bread"],
  flour: ["all-purpose flour", "whole wheat flour"],
  beans: ["black beans", "chickpeas", "kidney beans"],
  sauce: ["tomato sauce", "soy sauce", "pesto"],
  stock: ["chicken stock", "vegetable stock"],
  broth: ["chicken broth", "vegetable broth"],
  nuts: ["almonds", "walnuts", "peanuts"],
  "protein powder": [
    "whey protein powder",
    "pea protein powder",
    "plant protein powder",
  ],
};

type NutritionValues = {
  food: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};
type Props = {
  meal: MealType;
  onMealChange: (meal: MealType) => void;
  onAdd: (entry: NutritionValues) => void;
};
type EstimatedIngredient = ParsedIngredient &
  ReturnType<typeof estimateIngredientNutrition>;

function choicesFor(name: string) {
  return Object.entries(AMBIGUOUS_CHOICES).find(([generic]) =>
    new RegExp(`\\b${generic}\\b`, "i").test(name)
  )?.[1];
}

function estimate(
  item: ParsedIngredient,
  replacement?: string
): EstimatedIngredient {
  const name = replacement ?? item.ingredient;
  const grams = ingredientWeightGrams(name, item.quantity, item.unit);
  return { ...item, ...estimateIngredientNutrition(name, grams) };
}

function sumKnown(ingredients: EstimatedIngredient[]) {
  return ingredients.reduce(
    (sum, item) => ({
      calories: sum.calories + item.calories,
      protein: sum.protein + item.protein,
      carbs: sum.carbs + item.carbs,
      fat: sum.fat + item.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export function RecipeAnalyzer({ meal, onMealChange, onAdd }: Props) {
  const [recipeText, setRecipeText] = useState("");
  const [recipe, setRecipe] = useState<ParsedRecipe | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const calculated = useMemo(
    () =>
      recipe?.ingredients.map((item, index) =>
        estimate(item, overrides[index])
      ) ?? [],
    [recipe, overrides]
  );
  const totals = useMemo(() => sumKnown(calculated), [calculated]);
  const unresolved =
    recipe?.ingredients.some(
      (item, index) => item.ambiguous && !overrides[index]
    ) ?? false;
  const omittedFoods = calculated.some(item => !item.known);

  function analyze() {
    setRecipe(parseRecipe(recipeText));
    setOverrides({});
  }

  function logServing() {
    if (!recipe || !recipe.ingredients.length || unresolved) return;
    onAdd({
      food: recipe.title,
      calories: totals.calories / recipe.servings,
      protein: totals.protein / recipe.servings,
      carbs: totals.carbs / recipe.servings,
      fat: totals.fat / recipe.servings,
    });
    setRecipe(null);
    setRecipeText("");
  }

  return (
    <div className="space-y-3">
      <label
        htmlFor="recipe-text"
        className="block text-xs font-bold text-[#748277]"
      >
        PASTE A RECIPE OR INGREDIENT LIST
      </label>
      <textarea
        id="recipe-text"
        value={recipeText}
        onChange={event => {
          setRecipeText(event.target.value);
          setRecipe(null);
          setOverrides({});
        }}
        rows={7}
        maxLength={8000}
        placeholder={
          "Sunday banana oats\nServes 2\n1 cup rolled oats\n2 bananas\n1 cup whole milk"
        }
        className="w-full resize-y rounded-xl border border-[#e3e9df] bg-[#fcfdfa] px-4 py-3 text-sm leading-6 outline-none focus:border-[#86a97f] focus:ring-2 focus:ring-[#86a97f]/15"
      />
      <Button
        onClick={analyze}
        disabled={!recipeText.trim()}
        className="h-11 w-full rounded-xl bg-[#315941] font-bold hover:bg-[#234b37]"
      >
        <Sparkles className="mr-2" size={16} />
        Analyze recipe
      </Button>
      {recipe && (
        <div className="max-h-[460px] space-y-3 overflow-auto rounded-2xl bg-[#f6f8f2] p-4">
          <div>
            <p className="font-extrabold">{recipe.title}</p>
            <p className="text-xs text-[#809084]">
              {recipe.servings} {recipe.servings === 1 ? "serving" : "servings"}{" "}
              · {Math.round(totals.calories / recipe.servings)} kcal per serving{" "}
              <span className="text-[#9ba59d]">(known-food subtotal)</span>
            </p>
          </div>
          {recipe.notes.map(note => (
            <p
              key={note}
              className="flex gap-2 rounded-xl bg-amber-50 p-2 text-[11px] leading-4 text-amber-900"
            >
              <CircleHelp aria-hidden="true" className="h-4 w-4 shrink-0" />
              {note}
            </p>
          ))}
          {omittedFoods && (
            <p className="rounded-xl bg-amber-50 p-2 text-[11px] leading-4 text-amber-900">
              Nutrition for ingredients outside the built-in food list is
              excluded from this total.
            </p>
          )}
          {recipe.ingredients.map((item, index) => {
            const options = choicesFor(item.ingredient);
            return (
              <div
                key={`${item.ingredient}-${index}`}
                className="flex items-center justify-between gap-2 border-b border-[#e6ece2] pb-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {item.quantity ?? "some"} {item.unit} {item.ingredient}
                  </p>
                  <p className="text-[10px] text-[#8b998d]">
                    {calculated[index]?.known
                      ? `${calculated[index]?.calories} kcal`
                      : "Nutrition not in list · excluded"}
                  </p>
                </div>
                {item.ambiguous && options && (
                  <select
                    aria-label={`Choose type for ${item.ingredient}`}
                    value={overrides[index] ?? ""}
                    onChange={event =>
                      setOverrides(current => ({
                        ...current,
                        [index]: event.target.value,
                      }))
                    }
                    className="max-w-32 rounded-lg border border-[#e0e7dc] bg-white px-2 py-1.5 text-[10px]"
                  >
                    <option value="">Choose type…</option>
                    {options.map(choice => (
                      <option value={choice} key={choice}>
                        {choice}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
          <div className="rounded-xl bg-white p-3">
            <p className="text-xs font-bold">
              Per serving · {Math.round(totals.calories / recipe.servings)} kcal
            </p>
            <p className="mt-1 text-[10px] text-[#7c8b7e]">
              P {Math.round(totals.protein / recipe.servings)}g · C{" "}
              {Math.round(totals.carbs / recipe.servings)}g · F{" "}
              {Math.round(totals.fat / recipe.servings)}g
            </p>
          </div>
          <label className="block text-xs font-semibold text-[#748277]">
            ADD AS
            <select
              value={meal}
              onChange={event => onMealChange(event.target.value as MealType)}
              className="mt-1 w-full rounded-xl border border-[#e3e9df] bg-white px-3 py-2 text-sm"
            >
              {["breakfast", "lunch", "dinner", "snack"].map(value => (
                <option value={value} key={value}>
                  {value[0]?.toUpperCase()}
                  {value.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <Button
            onClick={logServing}
            disabled={unresolved || recipe.ingredients.length === 0}
            className="w-full rounded-xl bg-[#315941] hover:bg-[#234b37]"
          >
            {unresolved
              ? "Choose ingredient types first"
              : `Log a ${meal} serving`}
            <ArrowRight className="ml-2" size={15} />
          </Button>
        </div>
      )}
    </div>
  );
}
