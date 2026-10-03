import { COOKIE_NAME } from "@shared/const";
import { MEAL_TYPES } from "@shared/nutrition";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getNutritionSync, saveNutritionSync } from "./nutrition";
import { z } from "zod";

const nutritionEntrySchema = z.object({
  id: z.string().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Date must be a real calendar date"),
  meal: z.enum(MEAL_TYPES),
  food: z.string().trim().min(1).max(160),
  calories: z.number().finite().min(0).max(10000),
  protein: z.number().finite().min(0).max(1000),
  carbs: z.number().finite().min(0).max(1000),
  fat: z.number().finite().min(0).max(1000),
  updatedAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

const nutritionSnapshotSchema = z.object({
  version: z.literal(1),
  entries: z.array(nutritionEntrySchema).max(1000),
  goals: z.object({
    calories: z.number().finite().min(0).max(10000),
    protein: z.number().finite().min(0).max(1000),
    carbs: z.number().finite().min(0).max(1000),
    fat: z.number().finite().min(0).max(1000),
  }),
  goalsUpdatedAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  nutrition: router({
    pull: protectedProcedure.query(({ ctx }) => getNutritionSync(ctx.user.id)),
    push: protectedProcedure
      .input(z.object({
        baseRevision: z.number().int().nonnegative().max(2_000_000_000),
        snapshot: nutritionSnapshotSchema,
      }))
      .mutation(({ ctx, input }) => saveNutritionSync(ctx.user.id, input.snapshot, input.baseRevision)),
  }),
});

export type AppRouter = typeof appRouter;
