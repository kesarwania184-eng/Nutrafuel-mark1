import { COOKIE_NAME } from "@shared/const";
import { MEAL_TYPES } from "@shared/nutrition";
import {
  clearAccountSession,
  changeAccountPassword,
  consumeAuthRateLimit,
  createAccountPublicUser,
  loginAccount,
  normalizeEmail,
  registerAccount,
  setAccountSessionCookie,
} from "./accountAuth";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getNutritionSync, saveNutritionSync } from "./nutrition";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const nutritionEntrySchema = z.object({
  id: z.string().min(1).max(120),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(value => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return (
        Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
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

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform(normalizeEmail);
const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
const registerInputSchema = loginInputSchema.extend({
  name: z.string().trim().min(1).max(80),
  password: z
    .string()
    .min(12, "Use at least 12 characters for your password.")
    .max(128),
});

function enforceAuthRateLimit(ip: string | undefined, email: string) {
  if (!consumeAuthRateLimit(ip ?? "unknown", email)) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many sign-in attempts. Wait 15 minutes and try again.",
    });
  }
}

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) =>
      ctx.user ? createAccountPublicUser(ctx.user) : null
    ),
    register: publicProcedure
      .input(registerInputSchema)
      .mutation(async ({ ctx, input }) => {
        enforceAuthRateLimit(ctx.req.ip, input.email);
        const session = await registerAccount(input);
        setAccountSessionCookie(ctx.req, ctx.res, session);
        return { user: createAccountPublicUser(session.user) };
      }),
    login: publicProcedure
      .input(loginInputSchema)
      .mutation(async ({ ctx, input }) => {
        enforceAuthRateLimit(ctx.req.ip, input.email);
        const session = await loginAccount(input);
        setAccountSessionCookie(ctx.req, ctx.res, session);
        return { user: createAccountPublicUser(session.user) };
      }),
    changePassword: protectedProcedure
      .input(
        z.object({
          currentPassword: z.string().min(1).max(128),
          newPassword: z
            .string()
            .min(12, "Use at least 12 characters for your password.")
            .max(128),
        })
      )
      .mutation(async ({ ctx, input }) => {
        enforceAuthRateLimit(ctx.req.ip, ctx.user.email ?? String(ctx.user.id));
        const session = await changeAccountPassword(
          ctx.user.id,
          input.currentPassword,
          input.newPassword
        );
        setAccountSessionCookie(ctx.req, ctx.res, session);
        return { user: createAccountPublicUser(session.user) };
      }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      await clearAccountSession(ctx.req, ctx.res);
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
      .input(
        z.object({
          baseRevision: z.number().int().nonnegative().max(2_000_000_000),
          snapshot: nutritionSnapshotSchema,
        })
      )
      .mutation(({ ctx, input }) =>
        saveNutritionSync(ctx.user.id, input.snapshot, input.baseRevision)
      ),
  }),
});

export type AppRouter = typeof appRouter;
