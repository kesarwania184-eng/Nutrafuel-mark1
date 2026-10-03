import {
  Apple,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Utensils,
  Wheat,
  Zap,
} from "lucide-react";
import {
  summarizeEntries,
  type MealType,
  type NutritionEntry,
  type NutritionGoals,
} from "@shared/nutrition";

const MEALS: { id: MealType; label: string; emoji: string }[] = [
  { id: "breakfast", label: "Breakfast", emoji: "🌅" },
  { id: "lunch", label: "Lunch", emoji: "🥗" },
  { id: "dinner", label: "Dinner", emoji: "🌙" },
  { id: "snack", label: "Snack", emoji: "🍓" },
];

type GoalName = keyof NutritionGoals;
type Props = {
  date: string;
  goals: NutritionGoals;
  entries: NutritionEntry[];
  onDateChange: (date: string) => void;
  onGoalChange: (name: GoalName, value: number) => void;
  onRemove: (entry: NutritionEntry) => void;
};

function shiftDate(date: string, days: number) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

function formatDate(date: string) {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (date === todayKey) return "Today";
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

const GOAL_FIELDS: {
  label: string;
  key: GoalName;
  unit: string;
  max: number;
}[] = [
  { label: "Calories", key: "calories", unit: "kcal", max: 10000 },
  { label: "Protein", key: "protein", unit: "g", max: 1000 },
  { label: "Carbs", key: "carbs", unit: "g", max: 1000 },
  { label: "Fat", key: "fat", unit: "g", max: 1000 },
];

export function NutritionOverview({
  date,
  goals,
  entries,
  onDateChange,
  onGoalChange,
  onRemove,
}: Props) {
  const dayEntries = entries;
  const totals = summarizeEntries(dayEntries);
  const cards = [
    {
      label: "Protein",
      value: totals.protein,
      goal: goals.protein,
      unit: "g",
      tone: "#dfedce",
      Icon: Apple,
    },
    {
      label: "Carbs",
      value: totals.carbs,
      goal: goals.carbs,
      unit: "g",
      tone: "#f7e6c9",
      Icon: Wheat,
    },
    {
      label: "Fat",
      value: totals.fat,
      goal: goals.fat,
      unit: "g",
      tone: "#f6dcd0",
      Icon: Zap,
    },
    {
      label: "Meals",
      value: dayEntries.length,
      goal: 0,
      unit: "",
      tone: "#e4e8f6",
      Icon: Utensils,
    },
  ];

  return (
    <section className="rounded-[1.7rem] border border-white bg-white/85 p-5 shadow-[0_14px_45px_-30px_#526c58] sm:p-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.16em] text-[#87968a]">
            Your daily rhythm
          </p>
          <h2 className="mt-1 text-xl font-extrabold">
            The good stuff you ate
          </h2>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-[#f3f6f0] p-1">
          <button
            onClick={() => onDateChange(shiftDate(date, -1))}
            aria-label="Previous day"
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white"
          >
            <ChevronLeft size={17} />
          </button>
          <span className="min-w-24 text-center text-xs font-bold">
            {formatDate(date)}
          </span>
          <button
            onClick={() => onDateChange(shiftDate(date, 1))}
            aria-label="Next day"
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white"
          >
            <ChevronRight size={17} />
          </button>
          <CalendarDays
            aria-hidden="true"
            className="mr-2 ml-1 text-[#869687]"
            size={15}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(({ label, value, goal, unit, tone, Icon }) => (
          <div key={label} className="rounded-2xl bg-[#fafbf8] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#829087]">
                {label}
              </span>
              <span
                className="grid h-7 w-7 place-items-center rounded-lg"
                style={{ background: tone }}
              >
                <Icon size={14} />
              </span>
            </div>
            <p className="text-xl font-extrabold">
              {value}
              <span className="ml-1 text-xs font-semibold text-[#99a59c]">
                {unit}
              </span>
            </p>
            {goal > 0 ? (
              <div
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e9eee6]"
                role="progressbar"
                aria-label={`${label} daily target`}
                aria-valuenow={value}
                aria-valuemin={0}
                aria-valuemax={goal}
              >
                <div
                  className="h-full rounded-full bg-[#77a774] transition-all"
                  style={{ width: `${Math.min(100, (value / goal) * 100)}%` }}
                />
              </div>
            ) : (
              <p className="mt-2 text-[10px] text-[#99a59c]">
                logged with love
              </p>
            )}
          </div>
        ))}
      </div>

      <details className="mt-4 rounded-xl bg-[#f6f8f3] px-4 py-3">
        <summary className="cursor-pointer text-xs font-bold text-[#647769]">
          Personalize daily targets
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {GOAL_FIELDS.map(({ label, key, unit, max }) => (
            <label key={key} className="text-[10px] font-bold text-[#829087]">
              {label} · {unit}
              <input
                type="number"
                min="0"
                max={max}
                value={goals[key]}
                onChange={event =>
                  onGoalChange(
                    key,
                    Math.max(0, Math.min(max, Number(event.target.value) || 0))
                  )
                }
                className="mt-1 w-full rounded-lg border border-[#e1e8dd] bg-white px-2 py-2 text-sm text-[#26372d]"
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-[#94a095]">
          Targets are personal guideposts. Adjust them whenever you like.
        </p>
      </details>

      <div className="mt-5 space-y-3">
        {MEALS.map(meal => {
          const mealEntries = dayEntries.filter(
            entry => entry.meal === meal.id
          );
          return (
            <div
              key={meal.id}
              className="rounded-2xl border border-[#edf0e9] px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true">{meal.emoji}</span>
                  <span className="text-sm font-bold">{meal.label}</span>
                  <span className="rounded-full bg-[#f2f5ef] px-2 py-0.5 text-[10px] font-semibold text-[#8a998d]">
                    {mealEntries.length}
                  </span>
                </div>
                <span className="text-xs font-semibold text-[#758779]">
                  {summarizeEntries(mealEntries).calories} kcal
                </span>
              </div>
              {mealEntries.length > 0 && (
                <div className="mt-2 divide-y divide-[#f0f2ee]">
                  {mealEntries.map(entry => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between py-2"
                    >
                      <div>
                        <p className="text-sm font-semibold">{entry.food}</p>
                        <p className="text-[11px] text-[#89968c]">
                          {entry.calories} kcal · P {entry.protein}g · C{" "}
                          {entry.carbs}g · F {entry.fat}g
                        </p>
                      </div>
                      <button
                        onClick={() => onRemove(entry)}
                        aria-label={`Remove ${entry.food}`}
                        className="rounded-lg p-2 text-[#a3aea4] transition hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {dayEntries.length === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-[#dce5d8] px-4 py-4 text-center text-sm text-[#8b998d]">
          Your day is a blank plate. Add your first bite →
        </div>
      )}
    </section>
  );
}
