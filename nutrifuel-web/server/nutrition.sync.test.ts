import { describe, expect, it } from "vitest";
import {
  createEmptySnapshot,
  mergeSnapshots,
  normalizeSnapshot,
  snapshotFingerprint,
} from "@shared/nutrition";

describe("NutriFit sync engine", () => {
  it("normalizes legacy MVP entries without losing nutrition values", () => {
    const snapshot = normalizeSnapshot({
      entries: [
        {
          id: "legacy-1",
          date: "2026-10-03",
          meal: "lunch",
          name: "Rice bowl",
          kcal: 560,
          protein: 28,
        },
      ],
      goals: { calories: 2000, protein: 120 },
    });
    expect(snapshot.entries[0]).toMatchObject({
      food: "Rice bowl",
      calories: 560,
      protein: 28,
      carbs: 0,
      fat: 0,
    });
    expect(snapshot.goals).toMatchObject({
      calories: 2000,
      protein: 120,
      carbs: 220,
      fat: 70,
    });
  });

  it("merges independent device entries and chooses the newest edit", () => {
    const base = createEmptySnapshot("2026-10-03T08:00:00.000Z");
    const left = normalizeSnapshot({
      ...base,
      entries: [
        {
          id: "same",
          date: "2026-10-03",
          meal: "breakfast",
          food: "Oats",
          calories: 300,
          updatedAt: "2026-10-03T08:01:00.000Z",
        },
      ],
    });
    const right = normalizeSnapshot({
      ...base,
      entries: [
        {
          id: "same",
          date: "2026-10-03",
          meal: "breakfast",
          food: "Oats + banana",
          calories: 380,
          updatedAt: "2026-10-03T08:02:00.000Z",
        },
        {
          id: "other",
          date: "2026-10-03",
          meal: "snack",
          food: "Tea",
          calories: 5,
          updatedAt: "2026-10-03T08:03:00.000Z",
        },
      ],
    });
    const merged = mergeSnapshots(left, right);
    expect(merged.entries).toHaveLength(2);
    expect(merged.entries.find(entry => entry.id === "same")?.food).toBe(
      "Oats + banana"
    );
    expect(merged.entries.map(entry => entry.id)).toEqual(["other", "same"]);
  });

  it("keeps deletion tombstones so another device cannot resurrect a removed entry", () => {
    const left = normalizeSnapshot({
      entries: [
        {
          id: "gone",
          date: "2026-10-03",
          meal: "dinner",
          food: "Soup",
          calories: 200,
          updatedAt: "2026-10-03T08:01:00.000Z",
          deletedAt: "2026-10-03T08:02:00.000Z",
        },
      ],
    });
    const right = normalizeSnapshot({
      entries: [
        {
          id: "gone",
          date: "2026-10-03",
          meal: "dinner",
          food: "Soup",
          calories: 200,
          updatedAt: "2026-10-03T08:01:30.000Z",
        },
      ],
    });
    const merged = mergeSnapshots(left, right);
    expect(merged.entries[0]?.deletedAt).toBe("2026-10-03T08:02:00.000Z");
    expect(snapshotFingerprint(mergeSnapshots(merged, right))).toBe(
      snapshotFingerprint(merged)
    );
  });

  it("prefers a deletion on an equal-time conflict", () => {
    const timestamp = "2026-10-03T08:02:00.000Z";
    const deleted = normalizeSnapshot({
      entries: [
        {
          id: "same-time",
          date: "2026-10-03",
          meal: "dinner",
          food: "Soup",
          calories: 200,
          updatedAt: timestamp,
          deletedAt: timestamp,
        },
      ],
    });
    const live = normalizeSnapshot({
      entries: [
        {
          id: "same-time",
          date: "2026-10-03",
          meal: "dinner",
          food: "Soup",
          calories: 200,
          updatedAt: timestamp,
        },
      ],
    });
    expect(mergeSnapshots(deleted, live).entries[0]?.deletedAt).toBe(timestamp);
  });
});
