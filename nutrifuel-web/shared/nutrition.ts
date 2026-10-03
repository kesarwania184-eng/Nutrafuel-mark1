export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export type NutritionEntry = {
  id: string;
  date: string;
  meal: MealType;
  food: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  updatedAt: string;
  deletedAt?: string | null;
};

export type NutritionGoals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type NutritionTotals = Pick<
  NutritionGoals,
  "calories" | "protein" | "carbs" | "fat"
>;

export type NutritionSnapshot = {
  version: 1;
  entries: NutritionEntry[];
  goals: NutritionGoals;
  goalsUpdatedAt: string;
  updatedAt: string;
};

export const DEFAULT_GOALS: NutritionGoals = {
  calories: 2100,
  protein: 130,
  carbs: 220,
  fat: 70,
};

export function summarizeEntries(
  entries: readonly NutritionEntry[]
): NutritionTotals {
  return entries.reduce<NutritionTotals>(
    (total, entry) => ({
      calories: total.calories + entry.calories,
      protein: total.protein + entry.protein,
      carbs: total.carbs + entry.carbs,
      fat: total.fat + entry.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export function createEmptySnapshot(
  now = new Date().toISOString()
): NutritionSnapshot {
  return {
    version: 1,
    entries: [],
    goals: { ...DEFAULT_GOALS },
    goalsUpdatedAt: now,
    updatedAt: now,
  };
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

function asMeal(value: unknown): MealType {
  return MEAL_TYPES.includes(value as MealType) ? (value as MealType) : "snack";
}

function asIso(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function normalizeEntry(
  value: unknown,
  index: number,
  now: string
): NutritionEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const food =
    typeof candidate.food === "string"
      ? candidate.food.trim()
      : typeof candidate.name === "string"
        ? candidate.name.trim()
        : "";
  if (!food) return null;
  const updatedAt = asIso(candidate.updatedAt, now);
  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id
        : `migrated-${index}-${updatedAt}`,
    date: isCalendarDate(candidate.date) ? candidate.date : now.slice(0, 10),
    meal: asMeal(candidate.meal),
    food,
    calories: Math.round(asFiniteNumber(candidate.calories ?? candidate.kcal)),
    protein: Math.round(asFiniteNumber(candidate.protein)),
    carbs: Math.round(asFiniteNumber(candidate.carbs)),
    fat: Math.round(asFiniteNumber(candidate.fat)),
    updatedAt,
    deletedAt: candidate.deletedAt
      ? asIso(candidate.deletedAt, updatedAt)
      : null,
  };
}

export function normalizeSnapshot(
  value: unknown,
  now = new Date().toISOString()
): NutritionSnapshot {
  const candidate =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const rawEntries = Array.isArray(candidate.entries)
    ? candidate.entries
    : Array.isArray(candidate.items)
      ? candidate.items
      : [];
  const entries = rawEntries
    .map((entry, index) => normalizeEntry(entry, index, now))
    .filter((entry): entry is NutritionEntry => Boolean(entry));
  const rawGoals =
    candidate.goals && typeof candidate.goals === "object"
      ? (candidate.goals as Record<string, unknown>)
      : {};
  const goals: NutritionGoals = {
    calories: Math.round(
      asFiniteNumber(rawGoals.calories, DEFAULT_GOALS.calories)
    ),
    protein: Math.round(
      asFiniteNumber(rawGoals.protein, DEFAULT_GOALS.protein)
    ),
    carbs: Math.round(asFiniteNumber(rawGoals.carbs, DEFAULT_GOALS.carbs)),
    fat: Math.round(asFiniteNumber(rawGoals.fat, DEFAULT_GOALS.fat)),
  };
  return {
    version: 1,
    entries,
    goals,
    goalsUpdatedAt: asIso(candidate.goalsUpdatedAt, now),
    updatedAt: asIso(candidate.updatedAt, now),
  };
}

function compareVersions(left: string, right: string): number {
  const timeDifference = new Date(left).getTime() - new Date(right).getTime();
  if (Number.isFinite(timeDifference) && timeDifference !== 0)
    return timeDifference;
  return left.localeCompare(right);
}

function entryKey(entry: NutritionEntry): string {
  return JSON.stringify(entry);
}

function entryVersion(entry: NutritionEntry): string {
  if (
    !entry.deletedAt ||
    compareVersions(entry.deletedAt, entry.updatedAt) <= 0
  )
    return entry.updatedAt;
  return entry.deletedAt;
}

export function mergeSnapshots(
  local: NutritionSnapshot,
  remote: NutritionSnapshot
): NutritionSnapshot {
  const left = normalizeSnapshot(local);
  const right = normalizeSnapshot(remote);
  const byId = new Map<string, NutritionEntry>();
  for (const entry of [...left.entries, ...right.entries]) {
    const current = byId.get(entry.id);
    if (!current) {
      byId.set(entry.id, entry);
      continue;
    }
    const versionComparison = compareVersions(
      entryVersion(entry),
      entryVersion(current)
    );
    const deletionTieBreak =
      versionComparison === 0 &&
      Boolean(entry.deletedAt) !== Boolean(current.deletedAt)
        ? Boolean(entry.deletedAt)
        : false;
    if (
      versionComparison > 0 ||
      deletionTieBreak ||
      (versionComparison === 0 &&
        Boolean(entry.deletedAt) === Boolean(current.deletedAt) &&
        entryKey(entry) > entryKey(current))
    ) {
      byId.set(entry.id, entry);
    }
  }
  const goals =
    compareVersions(left.goalsUpdatedAt, right.goalsUpdatedAt) >= 0
      ? left.goals
      : right.goals;
  const goalsUpdatedAt =
    compareVersions(left.goalsUpdatedAt, right.goalsUpdatedAt) >= 0
      ? left.goalsUpdatedAt
      : right.goalsUpdatedAt;
  const entries = Array.from(byId.values()).sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  const updatedAt =
    compareVersions(left.updatedAt, right.updatedAt) >= 0
      ? left.updatedAt
      : right.updatedAt;
  return {
    version: 1,
    entries,
    goals: { ...goals },
    goalsUpdatedAt,
    updatedAt,
  };
}

export function visibleEntries(
  snapshot: NutritionSnapshot,
  date: string
): NutritionEntry[] {
  return snapshot.entries
    .filter(entry => entry.date === date && !entry.deletedAt)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

export function snapshotFingerprint(snapshot: NutritionSnapshot): string {
  return JSON.stringify(normalizeSnapshot(snapshot));
}
