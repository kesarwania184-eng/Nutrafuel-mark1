export type ParsedIngredient = {
  quantity: number | null;
  unit: string;
  ingredient: string;
  ambiguous: boolean;
};
export type ParsedRecipe = {
  title: string;
  servings: number;
  ingredients: ParsedIngredient[];
  notes: string[];
};

const AMBIGUOUS =
  /\b(oil|cheese|milk|yogurt|bread|rice|flour|beans|sauce|stock|broth|nuts|protein powder)\b/i;
const SPECIFIC_BY_TYPE: Array<[RegExp, RegExp]> = [
  [/\boil\b/i, /\b(olive|coconut|sesame|avocado|vegetable|canola)\b/i],
  [/\bcheese\b/i, /\b(cheddar|mozzarella|parmesan|feta|goat|swiss)\b/i],
  [/\bmilk\b/i, /\b(whole|skim|oat|almond|soy|2%)\b/i],
  [/\byogurt\b/i, /\b(greek|plain)\b/i],
  [/\brice\b/i, /\b(brown|white|jasmine|basmati)\b/i],
  [/\bbread\b/i, /\b(whole wheat|white|sourdough|rye)\b/i],
  [/\bflour\b/i, /\b(all-purpose|whole wheat|almond)\b/i],
  [/\bbeans\b/i, /\b(black|pinto|kidney|navy|cannellini)\b/i],
  [/\bsauce\b/i, /\b(tomato|soy|pesto|marinara|teriyaki)\b/i],
  [/\b(stock|broth)\b/i, /\b(chicken|vegetable|beef|fish)\b/i],
  [/\bnuts\b/i, /\b(almond|walnut|peanut|cashew|pecan|pistachio)\b/i],
  [/\bprotein powder\b/i, /\b(whey|pea|plant|soy)\b/i],
];
const UNITS =
  "cups?|c|tbsp|tablespoons?|tbsps?|tsp|teaspoons?|tsps?|oz|ounces?|lb|lbs|pounds?|g|grams?|kg|ml|milliliters?|l|liters?|pinch(?:es)?|cloves?|slices?|pieces?|large|medium|small";
const FRACTION: Record<string, number> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

function parseQuantity(raw: string): number | null {
  const normalized = raw
    .trim()
    .replace(
      /(\d)\s*([½⅓⅔¼¾⅛⅜⅝⅞])/g,
      (_, whole: string, part: string) => `${whole} ${FRACTION[part]}`
    );
  const parts = normalized.split(/\s+/);
  let sum = 0;
  for (const part of parts) {
    if (part in FRACTION) {
      sum += FRACTION[part];
      continue;
    }
    if (/^\d+\/\d+$/.test(part)) {
      const [n, d] = part.split("/").map(Number);
      if (!d) return null;
      sum += n / d;
      continue;
    }
    const n = Number(part);
    if (!Number.isFinite(n) || n < 0) return null;
    sum += n;
  }
  return sum > 0 ? sum : null;
}

export function parseServings(text: string): number {
  const patterns = [
    /(?:serves?|makes?|yield(?:s)?)\s*[:=-]?\s*(\d+\/\d+|\d+(?:\.\d+)?|[½⅓⅔¼¾⅛⅜⅝⅞])/i,
    /(?:servings?)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = parseQuantity(match[1]);
    if (value && value >= 0.25 && value <= 100) return value;
  }
  return 1;
}

export function parseRecipe(text: string): ParsedRecipe {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const title = (
    lines.find(
      line =>
        !/^(ingredients?:|instructions?:|method:|directions?:|serves?\b|makes?\b|yield\b)/i.test(
          line
        ) && !/^[-*•\d.)\s]*(?:\d|[½⅓⅔¼¾⅛⅜⅝⅞])/.test(line)
    ) ?? "Your recipe"
  )
    .replace(/^#+\s*/, "")
    .slice(0, 100);
  const notes: string[] = [];
  const ingredients: ParsedIngredient[] = [];
  let readingInstructions = false;
  for (const line of lines) {
    if (/^(instructions?:|method:|directions?:)/i.test(line)) {
      readingInstructions = true;
      continue;
    }
    if (readingInstructions) continue;
    if (
      /^(ingredients?:|instructions?:|method:|directions?:|serves?\b|makes?\b|yield\b)/i.test(
        line
      )
    )
      continue;
    const clean = line.replace(/^[-*•]\s*|^\d+[.)]\s*/, "");
    if (clean.replace(/^#+\s*/, "") === title) continue;
    if (
      !clean ||
      /^(step\s+\d+|preheat|mix |bake |cook |serve |heat |stir |combine |instructions?)/i.test(
        clean
      )
    )
      continue;
    const quantityMatch = clean.match(
      /^((?:\d+\s+)?\d+\/\d+|\d+[½⅓⅔¼¾⅛⅜⅝⅞]|[½⅓⅔¼¾⅛⅜⅝⅞]|\d+(?:\.\d+)?)\s*(.*)$/
    );
    const quantity = quantityMatch ? parseQuantity(quantityMatch[1]) : null;
    let remainder = quantityMatch ? quantityMatch[2].trim() : clean;
    const unitMatch = remainder.match(
      new RegExp(`^(${UNITS})\\b\\s*(.*)$`, "i")
    );
    const unit = unitMatch?.[1] ?? "";
    if (unitMatch) remainder = unitMatch[2];
    const ingredient = remainder
      .replace(/^of\s+/i, "")
      .replace(/[,;.]$/, "")
      .trim();
    const ambiguousType = AMBIGUOUS.exec(ingredient)?.[0] ?? "";
    const specificMatcher = ambiguousType
      ? SPECIFIC_BY_TYPE.find(([type]) => type.test(ambiguousType))?.[1]
      : undefined;
    const ambiguous =
      ambiguousType.length > 0 && !specificMatcher?.test(ingredient);
    if (ingredient.length > 1)
      ingredients.push({ quantity, unit, ingredient, ambiguous });
  }
  if (ingredients.some(item => item.ambiguous))
    notes.push(
      "Some ingredients need a specific variety or type before nutrition can be estimated accurately."
    );
  if (!ingredients.length)
    notes.push(
      "Add ingredients on separate lines, such as ‘1 cup rolled oats’."
    );
  return { title, servings: parseServings(text), ingredients, notes };
}

const FOOD_VALUES: Array<[RegExp, [number, number, number, number]]> = [
  [/^(?:rolled )?oats?$/, [389, 16.9, 66.3, 6.9]],
  [/^bananas?$/, [89, 1.1, 22.8, 0.3]],
  [/^eggs?$/, [143, 12.6, 0.7, 9.5]],
  [/^(?:chicken breast|chicken)$/, [165, 31, 0, 3.6]],
  [/^white rice$/, [130, 2.7, 28.2, 0.3]],
  [/^brown rice$/, [123, 2.7, 25.6, 1]],
  [/^(?:olive|vegetable|canola) oil$/, [884, 0, 0, 100]],
  [/^coconut oil$/, [862, 0, 0, 100]],
  [/^(?:oil)$/, [884, 0, 0, 100]],
  [/^butter$/, [717, 0.9, 0.1, 81]],
  [/^whole milk$/, [61, 3.2, 4.8, 3.3]],
  [/^skim milk$/, [34, 3.4, 5, 0.1]],
  [/^oat milk$/, [43, 1, 7, 1.5]],
  [/^almond milk$/, [15, 0.6, 0.3, 1.2]],
  [/^soy milk$/, [43, 3.3, 4.9, 1.8]],
  [/^(?:greek )?yogurt$/, [59, 10, 3.6, 0.4]],
  [/^almonds?$/, [579, 21.2, 21.6, 49.9]],
  [/^avocado$/, [160, 2, 8.5, 14.7]],
  [/^cheddar cheese$/, [403, 22.9, 3.4, 33.1]],
  [/^mozzarella cheese$/, [280, 27.5, 3.1, 17.1]],
  [/^parmesan cheese$/, [431, 38, 4.1, 29]],
  [/^whole wheat bread$/, [247, 13, 41, 4.2]],
  [/^white bread$/, [266, 8.9, 49, 3.3]],
  [/^sourdough bread$/, [289, 11, 56, 2.4]],
  [/^(?:all-purpose|plain) flour$/, [364, 10.3, 76.3, 1]],
  [/^whole wheat flour$/, [340, 13.2, 72, 2.5]],
  [/^black beans$/, [132, 8.9, 23.7, 0.5]],
  [/^chickpeas$/, [164, 8.9, 27.4, 2.6]],
  [/^kidney beans$/, [127, 8.7, 22.8, 0.5]],
  [/^tomato sauce$/, [29, 1.3, 6.7, 0.2]],
  [/^soy sauce$/, [53, 8, 4.9, 0.6]],
  [/^pesto$/, [418, 9.8, 8.5, 39]],
  [/^(?:chicken|vegetable) (?:stock|broth)$/, [6, 0.5, 0.7, 0.2]],
  [/^walnuts?$/, [654, 15.2, 13.7, 65.2]],
  [/^peanuts?$/, [567, 25.8, 16.1, 49.2]],
  [/^(?:whey|pea|plant) protein powder$/, [380, 75, 10, 5]],
  [/^salmon$/, [208, 20.4, 0, 13.4]],
  [/^broccoli$/, [34, 2.8, 6.6, 0.4]],
  [/^tomatoes?$/, [18, 0.9, 3.9, 0.2]],
];

const CUP_GRAMS: Array<[RegExp, number]> = [
  [/oats?/, 80],
  [/rice/, 185],
  [/milk/, 240],
  [/flour/, 120],
  [/beans|chickpeas/, 170],
  [/oil/, 218],
];
const TABLESPOON_GRAMS: Array<[RegExp, number]> = [
  [/oil|butter/, 14],
  [/flour/, 8],
  [/oats?/, 5],
  [/honey/, 21],
];
const TEASPOON_GRAMS: Array<[RegExp, number]> = [
  [/oil|butter/, 4.5],
  [/salt/, 6],
  [/sugar/, 4],
  [/honey/, 7],
];

/** Convert common recipe measures to approximate grams using food-aware densities. */
export function ingredientWeightGrams(
  name: string,
  quantity: number | null,
  rawUnit: string
): number {
  const amount = quantity ?? 1;
  const ingredient = name.toLowerCase();
  const unit = rawUnit.toLowerCase().replace(/s$/, "");
  let gramsPerUnit = 100;
  if (["g", "gram", "kg", "ml", "milliliter", "l", "liter"].includes(unit)) {
    gramsPerUnit = unit === "kg" || unit === "l" || unit === "liter" ? 1000 : 1;
  } else if (["cup", "c"].includes(unit)) {
    gramsPerUnit =
      CUP_GRAMS.find(([pattern]) => pattern.test(ingredient))?.[1] ?? 120;
  } else if (["tbsp", "tablespoon"].includes(unit)) {
    gramsPerUnit =
      TABLESPOON_GRAMS.find(([pattern]) => pattern.test(ingredient))?.[1] ?? 15;
  } else if (["tsp", "teaspoon"].includes(unit)) {
    gramsPerUnit =
      TEASPOON_GRAMS.find(([pattern]) => pattern.test(ingredient))?.[1] ?? 5;
  } else if (unit === "oz" || unit === "ounce") {
    gramsPerUnit = 28.35;
  } else if (unit === "lb" || unit === "pound") {
    gramsPerUnit = 453.6;
  } else if (unit === "pinch") {
    gramsPerUnit = 0.36;
  } else if (unit === "clove") {
    gramsPerUnit = 3;
  } else if (unit === "slice") {
    gramsPerUnit = 30;
  } else if (
    unit === "large" ||
    unit === "medium" ||
    unit === "small" ||
    unit === "piece"
  ) {
    const sizeScale = unit === "large" ? 1.15 : unit === "small" ? 0.75 : 1;
    const eachGrams = /egg/.test(ingredient)
      ? 50
      : /banana/.test(ingredient)
        ? 118
        : /avocado/.test(ingredient)
          ? 150
          : /tomato/.test(ingredient)
            ? 120
            : /clove|garlic/.test(ingredient)
              ? 3
              : 100;
    gramsPerUnit = eachGrams * sizeScale;
  } else if (!unit) {
    gramsPerUnit = /egg/.test(ingredient)
      ? 50
      : /banana/.test(ingredient)
        ? 118
        : /avocado/.test(ingredient)
          ? 150
          : /tomato/.test(ingredient)
            ? 120
            : /clove|garlic/.test(ingredient)
              ? 3
              : 100;
  }
  return Math.max(0, Math.min(10000, amount * gramsPerUnit));
}

export function estimateIngredientNutrition(
  name: string,
  grams: number
): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  known: boolean;
} {
  const key = name
    .toLowerCase()
    .trim()
    .replace(
      /^(chopped|diced|sliced|fresh|raw|cooked|grated|minced|crushed|ground|boneless|skinless)\s+/,
      ""
    )
    .replace(
      /\s+(?:chopped|diced|sliced|fresh|raw|cooked|grated|minced|crushed)$/,
      ""
    );
  const match = FOOD_VALUES.find(([pattern]) => pattern.test(key));
  // Unknown foods must not be assigned plausible-looking but invented macros.
  // The UI labels them unavailable and reports the known-food subtotal only.
  const per100 = match?.[1] ?? [0, 0, 0, 0];
  const factor = Math.max(0, Math.min(10000, grams)) / 100;
  return {
    calories: Math.round(per100[0] * factor),
    protein: Math.round(per100[1] * factor * 10) / 10,
    carbs: Math.round(per100[2] * factor * 10) / 10,
    fat: Math.round(per100[3] * factor * 10) / 10,
    known: Boolean(match),
  };
}
