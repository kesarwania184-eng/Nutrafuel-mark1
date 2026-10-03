import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MealType } from "@shared/nutrition";
import {
  estimateIngredientNutrition,
  ingredientWeightGrams,
} from "@shared/recipe";

const MEALS: { id: MealType; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snack" },
];
const QUICK_FOODS = [
  "Banana",
  "Greek yogurt",
  "Rolled oats",
  "Egg",
  "Chicken breast",
  "Avocado",
];
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

export function QuickAddForm({ meal, onMealChange, onAdd }: Props) {
  const [food, setFood] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const macros = [
    { label: "Protein", value: protein, update: setProtein },
    { label: "Carbs", value: carbs, update: setCarbs },
    { label: "Fat", value: fat, update: setFat },
  ];

  function chooseFood(name: string) {
    const estimate = estimateIngredientNutrition(
      name,
      ingredientWeightGrams(name, 1, "")
    );
    setFood(name);
    setCalories(String(estimate.calories));
    setProtein(String(estimate.protein));
    setCarbs(String(estimate.carbs));
    setFat(String(estimate.fat));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!food.trim()) return;
    onAdd({
      food,
      calories: Number(calories),
      protein: Number(protein),
      carbs: Number(carbs),
      fat: Number(fat),
    });
    setFood("");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label
        htmlFor="food-name"
        className="block text-xs font-bold text-[#748277]"
      >
        WHAT DID YOU EAT?
      </label>
      <input
        id="food-name"
        value={food}
        onChange={event => setFood(event.target.value)}
        maxLength={160}
        required
        placeholder="e.g. Cozy oatmeal with berries"
        className="w-full rounded-xl border border-[#e3e9df] bg-[#fcfdfa] px-4 py-3 text-sm outline-none transition focus:border-[#86a97f] focus:ring-2 focus:ring-[#86a97f]/15"
      />
      <div className="flex flex-wrap gap-2">
        {QUICK_FOODS.map(item => (
          <button
            type="button"
            key={item}
            onClick={() => chooseFood(item)}
            className="rounded-full bg-[#f1f5ec] px-3 py-1.5 text-[11px] font-semibold text-[#637869] transition hover:bg-[#e3eed8]"
          >
            + {item}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-[#748277]">
          MEAL
          <select
            value={meal}
            onChange={event => onMealChange(event.target.value as MealType)}
            className="mt-1.5 w-full rounded-xl border border-[#e3e9df] bg-[#fcfdfa] px-3 py-2.5 text-sm text-[#26372d]"
          >
            {MEALS.map(item => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-[#748277]">
          CALORIES
          <input
            type="number"
            min="0"
            max="10000"
            value={calories}
            onChange={event => setCalories(event.target.value)}
            placeholder="kcal"
            className="mt-1.5 w-full rounded-xl border border-[#e3e9df] bg-[#fcfdfa] px-3 py-2.5 text-sm outline-none focus:border-[#86a97f]"
          />
        </label>
      </div>
      <details>
        <summary className="cursor-pointer text-xs font-semibold text-[#78877d]">
          Add macros <span className="text-[#a2aea3]">(optional)</span>
        </summary>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {macros.map(({ label, value, update }) => (
            <label key={label} className="text-[10px] font-bold text-[#859287]">
              {label}
              <input
                type="number"
                min="0"
                max="1000"
                step=".1"
                value={value}
                onChange={event => update(event.target.value)}
                placeholder="g"
                className="mt-1 w-full rounded-lg border border-[#e3e9df] bg-white px-2 py-2 text-sm"
              />
            </label>
          ))}
        </div>
      </details>
      <Button
        type="submit"
        className="h-12 w-full rounded-xl bg-[#315941] font-bold text-white shadow-md shadow-emerald-950/10 transition hover:-translate-y-0.5 hover:bg-[#234b37]"
      >
        Add to my day <ArrowRight className="ml-2" size={16} />
      </Button>
      <p className="text-center text-[10px] text-[#98a49a]">
        No calorie estimate? No problem—log it anyway.
      </p>
    </form>
  );
}
