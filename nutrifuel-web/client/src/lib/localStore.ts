import {
  createEmptySnapshot,
  normalizeSnapshot,
  type NutritionSnapshot,
} from "@shared/nutrition";

const ANONYMOUS_KEY = "nutrifit:local:v1";
const USER_KEY_PREFIX = "nutrifit:local:user:";
const MIGRATION_KEY = "nutrifit:migration:v1";

function safeRead(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function scopedKey(openId?: string): string {
  return openId
    ? `${USER_KEY_PREFIX}${encodeURIComponent(openId)}`
    : ANONYMOUS_KEY;
}

function readLegacySnapshot(): { snapshot: NutritionSnapshot; found: boolean } {
  const legacyEntries = [
    safeRead("nutrifit:entries"),
    safeRead("nutrifit:daily-log"),
    safeRead("nutrifit_entries"),
  ].find(value => Array.isArray(value));
  const legacyGoals = safeRead("nutrifit-goals") ?? safeRead("nutrifit:goals");
  if (!legacyEntries && !legacyGoals) {
    return { snapshot: createEmptySnapshot(), found: false };
  }
  return {
    snapshot: normalizeSnapshot({
      entries: legacyEntries ?? [],
      goals: legacyGoals ?? undefined,
    }),
    found: true,
  };
}

export function loadLocalNutrition(openId?: string): {
  snapshot: NutritionSnapshot;
  migratedLegacy: boolean;
} {
  const scoped = safeRead(scopedKey(openId));
  if (scoped) {
    return { snapshot: normalizeSnapshot(scoped), migratedLegacy: false };
  }
  const anonymous = openId ? safeRead(ANONYMOUS_KEY) : null;
  if (anonymous) {
    return { snapshot: normalizeSnapshot(anonymous), migratedLegacy: true };
  }
  const legacy = readLegacySnapshot();
  return { snapshot: legacy.snapshot, migratedLegacy: legacy.found };
}

export function saveLocalNutrition(
  snapshot: NutritionSnapshot,
  openId?: string
): boolean {
  try {
    window.localStorage.setItem(
      scopedKey(openId),
      JSON.stringify(normalizeSnapshot(snapshot))
    );
    return true;
  } catch {
    return false;
  }
}

export function markMigrationComplete(openId: string): void {
  try {
    window.localStorage.setItem(
      `${MIGRATION_KEY}:${encodeURIComponent(openId)}`,
      new Date().toISOString()
    );
    window.localStorage.removeItem(ANONYMOUS_KEY);
    [
      "nutrifit:entries",
      "nutrifit:daily-log",
      "nutrifit_entries",
      "nutrifit-goals",
      "nutrifit:goals",
    ].forEach(key => {
      window.localStorage.removeItem(key);
    });
  } catch {
    // Best effort; never block a successful server sync.
  }
}

export function getStoredRevision(openId: string): number {
  try {
    const value = Number(
      window.localStorage.getItem(
        `${MIGRATION_KEY}:revision:${encodeURIComponent(openId)}`
      ) ?? 0
    );
    return Number.isSafeInteger(value) && value >= 0 && value <= 2_000_000_000
      ? value
      : 0;
  } catch {
    return 0;
  }
}

export function saveStoredRevision(openId: string, revision: number): void {
  try {
    window.localStorage.setItem(
      `${MIGRATION_KEY}:revision:${encodeURIComponent(openId)}`,
      String(revision)
    );
  } catch {
    // Best effort only.
  }
}
