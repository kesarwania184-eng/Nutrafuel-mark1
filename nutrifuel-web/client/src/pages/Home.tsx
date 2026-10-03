import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChefHat,
  Flame,
  Leaf,
  Plus,
  RotateCcw,
  Sparkles,
  Check,
  ArrowRight,
  LogIn,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  mergeSnapshots,
  normalizeSnapshot,
  snapshotFingerprint,
  summarizeEntries,
  visibleEntries,
  type MealType,
  type NutritionEntry,
  type NutritionGoals,
  type NutritionSnapshot,
} from "@shared/nutrition";
import {
  getStoredRevision,
  loadLocalNutrition,
  markMigrationComplete,
  saveLocalNutrition,
  saveStoredRevision,
} from "@/lib/localStore";
import { NutritionOverview } from "@/components/nutrition/NutritionOverview";
import { QuickAddForm } from "@/components/nutrition/QuickAddForm";
import { RecipeAnalyzer } from "@/components/nutrition/RecipeAnalyzer";

const AccountDialog = lazy(() =>
  import("@/components/AccountDialog").then(module => ({
    default: module.AccountDialog,
  }))
);

type FoodValues = {
  food: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function createId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function cap(value: number, maximum: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(maximum, value)) : 0;
}

function statusTone(status: string) {
  if (/paused|offline|not configured|unavailable|could not/i.test(status))
    return "bg-rose-400";
  if (/sync|saved|changes waiting|backed up/i.test(status))
    return "bg-emerald-500";
  return "bg-amber-400";
}

export default function Home() {
  const { user, logout } = useAuth();
  const [snapshot, setSnapshot] = useState<NutritionSnapshot>(
    () => loadLocalNutrition().snapshot
  );
  const [date, setDate] = useState(localDate);
  const [meal, setMeal] = useState<MealType>("breakfast");
  const [tab, setTab] = useState<"log" | "recipe">("log");
  const [toast, setToast] = useState("");
  const [syncStatus, setSyncStatus] = useState("Saved on this device");
  const [revision, setRevision] = useState(0);
  const [accountReadyId, setAccountReadyId] = useState<string | null>(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [onlineEpoch, setOnlineEpoch] = useState(0);
  const uploadedSnapshot = useRef<{
    openId: string;
    fingerprint: string;
  } | null>(null);
  const localSaveAvailable = useRef(true);
  const toastTimer = useRef<number | null>(null);
  const entries = useMemo(
    () => visibleEntries(snapshot, date),
    [snapshot, date]
  );
  const dayTotals = useMemo(() => summarizeEntries(entries), [entries]);
  const pull = trpc.nutrition.pull.useQuery(undefined, {
    enabled: Boolean(user),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const push = trpc.nutrition.push.useMutation();
  const pushSnapshot = push.mutateAsync;

  useLayoutEffect(() => {
    const local = loadLocalNutrition(user?.openId);
    setSnapshot(local.snapshot);
    setRevision(user?.openId ? getStoredRevision(user.openId) : 0);
    setAccountReadyId(null);
    uploadedSnapshot.current = null;
  }, [user?.openId]);

  useEffect(() => {
    localSaveAvailable.current = saveLocalNutrition(snapshot, user?.openId);
    if (!localSaveAvailable.current) {
      setSyncStatus(
        "Device storage is unavailable · download a backup or sign in to sync"
      );
    }
  }, [snapshot, user?.openId]);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    []
  );

  useEffect(() => {
    const retrySync = () => setOnlineEpoch(value => value + 1);
    window.addEventListener("online", retrySync);
    return () => window.removeEventListener("online", retrySync);
  }, []);

  useEffect(() => {
    if (!user?.openId) return;
    const openId = user.openId;
    let active = true;

    async function loadAccountData() {
      setSyncStatus("Checking your account…");
      try {
        // Refetch after account changes so cached data from a previous user
        // cannot be merged into this user's browser storage.
        const response = await pull.refetch();
        if (!active || !response.data) return;

        const serverSnapshot = response.data.snapshot;
        const localSnapshot = loadLocalNutrition(openId).snapshot;
        const merged = mergeSnapshots(serverSnapshot, localSnapshot);
        setSnapshot(current => mergeSnapshots(merged, current));
        setRevision(response.data.revision);
        saveStoredRevision(openId, response.data.revision);

        if (
          snapshotFingerprint(merged) !== snapshotFingerprint(serverSnapshot)
        ) {
          setSyncStatus("Saving your latest changes…");
          const result = await push.mutateAsync({
            baseRevision: response.data.revision,
            snapshot: merged,
          });
          if (!active) return;
          setSnapshot(current => mergeSnapshots(result.snapshot, current));
          setRevision(result.revision);
          saveStoredRevision(openId, result.revision);
          uploadedSnapshot.current = {
            openId,
            fingerprint: snapshotFingerprint(result.snapshot),
          };
        } else {
          uploadedSnapshot.current = {
            openId,
            fingerprint: snapshotFingerprint(serverSnapshot),
          };
        }
        markMigrationComplete(openId);
        if (active) {
          setAccountReadyId(openId);
          setSyncStatus("Synced to your account");
        }
      } catch {
        if (active) {
          setSyncStatus(
            localSaveAvailable.current
              ? "Offline · your device copy is safe"
              : "Offline · download a backup before leaving this page"
          );
        }
      }
    }

    void loadAccountData();
    return () => {
      active = false;
    };
  }, [user?.openId]);

  // Wait for the account pull/merge above, then back up every edit automatically.
  // The browser copy stays in place and continues to work while offline.
  useEffect(() => {
    const openId = user?.openId;
    if (!openId || accountReadyId !== openId) return;
    const fingerprint = snapshotFingerprint(snapshot);
    if (
      uploadedSnapshot.current?.openId === openId &&
      uploadedSnapshot.current.fingerprint === fingerprint
    )
      return;

    const timer = window.setTimeout(async () => {
      setSyncStatus("Saving your meal history…");
      try {
        const result = await pushSnapshot({ baseRevision: revision, snapshot });
        if (user?.openId !== openId) return;
        setSnapshot(current => mergeSnapshots(result.snapshot, current));
        setRevision(result.revision);
        saveStoredRevision(openId, result.revision);
        uploadedSnapshot.current = {
          openId,
          fingerprint: snapshotFingerprint(result.snapshot),
        };
        setSyncStatus("Meal history backed up to your account");
      } catch {
        if (user?.openId === openId) {
          setSyncStatus(
            localSaveAvailable.current
              ? "Sync paused · your on-device history is still available"
              : "Sync failed · download a backup before leaving this page"
          );
        }
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [
    accountReadyId,
    onlineEpoch,
    pushSnapshot,
    revision,
    snapshot,
    user?.openId,
  ]);

  function updateSnapshot(
    update: (current: NutritionSnapshot) => NutritionSnapshot
  ) {
    setSnapshot(current =>
      update({ ...current, entries: [...current.entries] })
    );
    setSyncStatus(user ? "Changes waiting to sync" : "Saved on this device");
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }

  function addEntry(values: FoodValues) {
    if (!values.food.trim()) return;
    const now = new Date().toISOString();
    const entry: NutritionEntry = {
      id: createId(),
      date,
      meal,
      food: values.food.trim().slice(0, 160),
      calories: Math.round(cap(values.calories, 10000)),
      protein: Math.round(cap(values.protein, 1000) * 10) / 10,
      carbs: Math.round(cap(values.carbs, 1000) * 10) / 10,
      fat: Math.round(cap(values.fat, 1000) * 10) / 10,
      updatedAt: now,
    };
    updateSnapshot(current => ({
      ...current,
      entries: [...current.entries, entry],
      updatedAt: now,
    }));
    showToast(`${entry.food} added to ${meal}`);
  }

  function removeEntry(entry: NutritionEntry) {
    const now = new Date().toISOString();
    updateSnapshot(current => ({
      ...current,
      entries: current.entries.map(item =>
        item.id === entry.id
          ? { ...item, updatedAt: now, deletedAt: now }
          : item
      ),
      updatedAt: now,
    }));
  }

  function updateGoal(name: keyof NutritionGoals, value: number) {
    const now = new Date().toISOString();
    updateSnapshot(current => ({
      ...current,
      goals: { ...current.goals, [name]: value },
      goalsUpdatedAt: now,
      updatedAt: now,
    }));
  }

  async function syncNow() {
    if (!user) return;
    setSyncStatus("Syncing…");
    try {
      const submitted = snapshot;
      const result = await pushSnapshot({
        baseRevision: revision,
        snapshot: submitted,
      });
      setSnapshot(current => mergeSnapshots(result.snapshot, current));
      setRevision(result.revision);
      saveStoredRevision(user.openId, result.revision);
      markMigrationComplete(user.openId);
      uploadedSnapshot.current = {
        openId: user.openId,
        fingerprint: snapshotFingerprint(result.snapshot),
      };
      setAccountReadyId(user.openId);
      setSyncStatus(
        result.conflictResolved
          ? "Synced · changes from both devices combined"
          : "All synced"
      );
    } catch {
      setSyncStatus(
        localSaveAvailable.current
          ? "Sync paused · your device copy is safe"
          : "Sync failed · download a backup before leaving this page"
      );
    }
  }

  function restoreBackup(imported: NutritionSnapshot) {
    updateSnapshot(current => ({
      ...mergeSnapshots(current, normalizeSnapshot(imported)),
      updatedAt: new Date().toISOString(),
    }));
    showToast("Backup merged with your meal history");
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_12%_0%,#fff0d8_0%,transparent_35%),linear-gradient(135deg,#fbfaf6,#f4f6ec_55%,#fffaf0)] text-[#1d3027]">
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-5 sm:px-8 lg:px-10">
        <header className="mb-8 flex items-center justify-between">
          <a
            href="/"
            className="flex items-center gap-3"
            aria-label="NutriFuel home"
          >
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#244c3d] text-white shadow-lg shadow-emerald-950/15">
              <Leaf size={23} />
            </div>
            <div>
              <p className="text-xl font-black tracking-tight">NutriFuel</p>
              <p className="-mt-0.5 text-[11px] font-semibold uppercase tracking-[.17em] text-[#718277]">
                Eat well, feel great
              </p>
            </div>
          </a>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs font-medium text-[#829087] sm:block">
              {syncStatus}
            </span>
            <span
              className={`h-2.5 w-2.5 rounded-full ${statusTone(syncStatus)}`}
              title={syncStatus}
              aria-label={syncStatus}
            />
            {user && (
              <Button
                onClick={syncNow}
                disabled={push.isPending}
                variant="outline"
                className="rounded-full border-[#dbe2d8] bg-white/75 text-xs"
              >
                Sync now
                <RotateCcw className="ml-2 h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              type="button"
              onClick={() => setAccountDialogOpen(true)}
              variant={user ? "outline" : "default"}
              className="max-w-44 rounded-full bg-white/90 text-xs text-[#315941] hover:bg-white"
            >
              {user ? (
                <ShieldCheck className="h-4 w-4" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              <span className="truncate">
                {user
                  ? user.name?.trim() || user.email || "Your account"
                  : "Sign in / Create account"}
              </span>
            </Button>
            {accountDialogOpen && (
              <Suspense fallback={null}>
                <AccountDialog
                  open={accountDialogOpen}
                  onOpenChange={setAccountDialogOpen}
                  user={user}
                  snapshot={snapshot}
                  onRestore={restoreBackup}
                  onLogout={logout}
                />
              </Suspense>
            )}
          </div>
        </header>

        <section className="relative mb-7 overflow-hidden rounded-[2rem] bg-[#244c3d] px-6 py-8 text-white shadow-xl shadow-[#214333]/10 sm:px-10 sm:py-10">
          <div
            aria-hidden="true"
            className="absolute -right-8 -top-28 h-72 w-72 rounded-full border-[35px] border-white/5"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-32 right-36 h-64 w-64 rounded-full bg-[#d6ef9b]/10 blur-3xl"
          />
          <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-[#d9f3b0]">
                <Sparkles size={14} /> Your feel-good food journal
              </div>
              <h1 className="max-w-xl text-3xl font-black leading-tight tracking-tight sm:text-5xl">
                A little more mindful.
                <br />
                <span className="text-[#c9e89b]">A lot more you.</span>
              </h1>
              <p className="mt-4 max-w-lg text-sm leading-6 text-white/70 sm:text-base">
                Track your meals, celebrate the small wins, and find your rhythm
                one delicious bite at a time.
              </p>
            </div>
            <div className="flex items-end gap-3 rounded-2xl bg-white/10 p-4 backdrop-blur sm:min-w-64">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e0f1b8] text-[#315941]">
                <Flame size={23} />
              </div>
              <div className="flex-1">
                <p className="text-2xl font-black">
                  {dayTotals.calories.toLocaleString()}{" "}
                  <span className="text-sm font-semibold text-white/60">
                    kcal
                  </span>
                </p>
                <p className="text-xs text-white/65">fuel in your tank today</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold">
                  {Math.max(
                    0,
                    snapshot.goals.calories - dayTotals.calories
                  ).toLocaleString()}
                </p>
                <p className="text-[10px] text-white/60">left to goal</p>
              </div>
            </div>
          </div>
        </section>

        <div className="mb-6 grid gap-5 lg:grid-cols-[1.35fr_.85fr]">
          <NutritionOverview
            date={date}
            goals={snapshot.goals}
            entries={entries}
            onDateChange={setDate}
            onGoalChange={updateGoal}
            onRemove={removeEntry}
          />
          <section className="rounded-[1.7rem] border border-white bg-white/85 p-5 shadow-[0_14px_45px_-30px_#526c58] sm:p-7">
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-[.16em] text-[#87968a]">
                Make it count
              </p>
              <h2 className="mt-1 text-xl font-extrabold">
                Add a little goodness
              </h2>
            </div>
            <div
              className="mb-5 grid grid-cols-2 rounded-xl bg-[#f2f5ef] p-1"
              role="tablist"
              aria-label="Choose how to add food"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "log"}
                onClick={() => setTab("log")}
                className={`rounded-lg py-2 text-xs font-bold transition ${tab === "log" ? "bg-white text-[#315941] shadow-sm" : "text-[#829087]"}`}
              >
                <Plus className="mr-1 inline" size={14} />
                Quick add
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "recipe"}
                onClick={() => setTab("recipe")}
                className={`rounded-lg py-2 text-xs font-bold transition ${tab === "recipe" ? "bg-white text-[#315941] shadow-sm" : "text-[#829087]"}`}
              >
                <ChefHat className="mr-1 inline" size={14} />
                Recipe magic
              </button>
            </div>
            {tab === "log" ? (
              <QuickAddForm
                meal={meal}
                onMealChange={setMeal}
                onAdd={addEntry}
              />
            ) : (
              <RecipeAnalyzer
                meal={meal}
                onMealChange={setMeal}
                onAdd={addEntry}
              />
            )}
          </section>
        </div>

        <footer className="flex flex-col items-center justify-between gap-2 px-2 text-[11px] text-[#98a49a] sm:flex-row">
          <span>Small steps, strong roots 🌱</span>
          <span>Nutrition values are estimates. Listen to your body.</span>
        </footer>
        {toast && (
          <div
            role="status"
            className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#244c3d] px-5 py-3 text-sm font-semibold text-white shadow-xl"
          >
            <Check size={16} className="text-[#c9e89b]" />
            {toast}
            <ArrowRight aria-hidden="true" size={14} />
          </div>
        )}
      </div>
    </div>
  );
}
