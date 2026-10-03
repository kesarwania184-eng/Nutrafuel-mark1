import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createEmptySnapshot,
  mergeSnapshots,
  normalizeSnapshot,
  snapshotFingerprint,
  type NutritionSnapshot,
} from "@shared/nutrition";
import { userNutritionData } from "../drizzle/schema";
import { getDb } from "./db";

export type NutritionSyncResult = {
  snapshot: NutritionSnapshot;
  revision: number;
  conflictResolved: boolean;
  serverUpdatedAt: string;
};

function requireDatabase<T>(db: T | null): T {
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "The NutriFit database is temporarily unavailable. Your local log is safe; try syncing again shortly.",
    });
  }
  return db;
}

function parseSnapshot(raw: string | null | undefined): NutritionSnapshot {
  if (!raw) return createEmptySnapshot();
  try {
    return normalizeSnapshot(JSON.parse(raw));
  } catch (error) {
    console.error(
      "[Nutrition] Stored snapshot is unreadable; refusing to overwrite it",
      error
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Your saved nutrition data could not be read. It has been preserved; contact support before retrying sync.",
      cause: error,
    });
  }
}

export async function getNutritionSync(
  userId: number
): Promise<NutritionSyncResult> {
  const db = requireDatabase(await getDb());
  const rows = await db
    .select()
    .from(userNutritionData)
    .where(eq(userNutritionData.userId, userId))
    .limit(1);
  const row = rows[0];
  return {
    snapshot: parseSnapshot(row?.snapshot),
    revision: row?.revision ?? 0,
    conflictResolved: false,
    serverUpdatedAt: row?.updatedAt?.toISOString() ?? new Date(0).toISOString(),
  };
}

export async function saveNutritionSync(
  userId: number,
  incoming: NutritionSnapshot,
  baseRevision: number
): Promise<NutritionSyncResult> {
  const db = requireDatabase(await getDb());
  const normalizedIncoming = normalizeSnapshot(incoming);
  // Serialize per-user read/merge/write cycles. Without the transaction lock,
  // two devices can read revision N and the later update silently erase the
  // earlier device's independent entry.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(async tx => {
        const rows = await tx
          .select()
          .from(userNutritionData)
          .where(eq(userNutritionData.userId, userId))
          .limit(1)
          .for("update");
        const row = rows[0];
        const currentRevision = row?.revision ?? 0;
        const currentSnapshot = parseSnapshot(row?.snapshot);
        const merged = mergeSnapshots(currentSnapshot, normalizedIncoming);
        const changed =
          snapshotFingerprint(currentSnapshot) !== snapshotFingerprint(merged);
        const nextRevision = changed ? currentRevision + 1 : currentRevision;
        const now = new Date();

        if (row && changed) {
          await tx
            .update(userNutritionData)
            .set({
              snapshot: JSON.stringify(merged),
              revision: nextRevision,
              updatedAt: now,
            })
            .where(eq(userNutritionData.userId, userId));
        } else if (!row) {
          await tx.insert(userNutritionData).values({
            userId,
            snapshot: JSON.stringify(merged),
            revision: 1,
          });
        }

        return {
          snapshot: merged,
          revision: row ? nextRevision : 1,
          conflictResolved: baseRevision !== currentRevision,
          serverUpdatedAt:
            changed || !row ? now.toISOString() : row.updatedAt.toISOString(),
        };
      });
    } catch (error) {
      const dbError = error as { code?: string; errno?: number };
      const retryable =
        dbError.code === "ER_LOCK_DEADLOCK" ||
        dbError.code === "ER_DUP_ENTRY" ||
        dbError.code === "ER_LOCK_WAIT_TIMEOUT" ||
        dbError.errno === 1205 ||
        dbError.errno === 1213 ||
        dbError.errno === 1062;
      if (!retryable || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Could not complete nutrition sync.",
  });
}
