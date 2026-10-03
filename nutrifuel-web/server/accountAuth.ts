import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { authSessions, users, type User } from "../drizzle/schema";
import { getDb } from "./db";

export const ACCOUNT_SESSION_COOKIE = "nutrifuel_session";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const PASSWORD_BYTES = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_BYTES, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt);
  return `scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string
): Promise<boolean> {
  const parts = encoded.split("$");
  if (
    parts.length !== 6 ||
    parts[0] !== "scrypt" ||
    parts[1] !== "16384" ||
    parts[2] !== "8" ||
    parts[3] !== "1"
  ) {
    return false;
  }
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  if (salt.length !== 16 || expected.length !== PASSWORD_BYTES) return false;
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected);
}

type AccountInput = { email: string; password: string; name?: string };
type AccountSession = { user: User; token: string; expiresAt: Date };

function unavailableDatabase(): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Account sign-in needs a configured database. Your current device log is still available.",
  });
}

async function createSession(tx: any, userId: number): Promise<AccountSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MS);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await tx.insert(authSessions).values({ userId, tokenHash, expiresAt });
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not load the new account.",
    });
  return { user, token, expiresAt };
}

export async function registerAccount(
  input: AccountInput
): Promise<AccountSession> {
  const db = await getDb();
  if (!db) throw unavailableDatabase();
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  try {
    return await db.transaction(async tx => {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.emailNormalized, email))
        .limit(1);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "An account may already use this email. Try signing in instead.",
        });
      }

      const [created] = await tx
        .insert(users)
        .values({
          openId: `email_${randomUUID()}`,
          name: input.name?.trim() || null,
          email,
          emailNormalized: email,
          passwordHash,
          loginMethod: "email",
          lastSignedIn: now,
        })
        .$returningId();
      if (!created)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not create the account.",
        });
      return createSession(tx, created.id);
    });
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const dbError = error as { code?: string; errno?: number };
    if (dbError.code === "ER_DUP_ENTRY" || dbError.errno === 1062) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "An account may already use this email. Try signing in instead.",
      });
    }
    console.error("[Auth] Account registration failed", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Account creation failed. Please try again.",
    });
  }
}

export async function loginAccount(
  input: AccountInput
): Promise<AccountSession> {
  const db = await getDb();
  if (!db) throw unavailableDatabase();
  const email = normalizeEmail(input.email);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.emailNormalized, email))
    .limit(1);

  // Spend the same password-hash effort when the address is unknown or belongs
  // to an OAuth-only account, reducing useful account-enumeration timing clues.
  const passwordMatches = user?.passwordHash
    ? await verifyPassword(input.password, user.passwordHash)
    : (await deriveKey(input.password, Buffer.alloc(16)), false);
  if (!user?.passwordHash || !passwordMatches) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Email or password is incorrect.",
    });
  }

  try {
    return await db.transaction(async tx => {
      await tx
        .update(users)
        .set({ lastSignedIn: new Date() })
        .where(eq(users.id, user.id));
      await tx
        .delete(authSessions)
        .where(lt(authSessions.expiresAt, new Date()));
      return createSession(tx, user.id);
    });
  } catch (error) {
    console.error("[Auth] Account sign-in failed", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not start a secure session. Please try again.",
    });
  }
}

export async function changeAccountPassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<AccountSession> {
  const db = await getDb();
  if (!db) throw unavailableDatabase();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user?.passwordHash) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This account does not use an email password.",
    });
  }
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Current password is incorrect.",
    });
  }
  const passwordHash = await hashPassword(newPassword);
  return db.transaction(async tx => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    // Revoke every previous device session, then issue a fresh session below.
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    return createSession(tx, userId);
  });
}

function readAccountToken(req: Request): string | null {
  const value = parseCookieHeader(req.headers.cookie ?? "")[
    ACCOUNT_SESSION_COOKIE
  ];
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(value)
    ? value
    : null;
}

export async function getAccountUser(req: Request): Promise<User | null> {
  const token = readAccountToken(req);
  if (!token) return null;
  const db = await getDb();
  if (!db) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [result] = await db
    .select({ user: users })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash),
        gt(authSessions.expiresAt, new Date())
      )
    )
    .limit(1);
  return result?.user ?? null;
}

export function setAccountSessionCookie(
  req: Request,
  res: Response,
  session: AccountSession
): void {
  res.cookie(ACCOUNT_SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || req.secure,
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
}

export async function clearAccountSession(
  req: Request,
  res: Response
): Promise<void> {
  const token = readAccountToken(req);
  const db = await getDb();
  let revokeFailed = false;
  if (token && db) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    try {
      await db
        .delete(authSessions)
        .where(eq(authSessions.tokenHash, tokenHash));
    } catch (error) {
      console.error("[Auth] Session revocation failed", error);
      revokeFailed = true;
    }
  }
  res.clearCookie(ACCOUNT_SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || req.secure,
    sameSite: "lax",
    path: "/",
  });
  if (revokeFailed) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "This device signed out, but the session could not be revoked on the server. Try signing out again when the connection is restored.",
    });
  }
}

type RateBucket = { count: number; resetsAt: number };
const rateBuckets = new Map<string, RateBucket>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60 * 1000;

export function consumeAuthRateLimit(
  ip: string,
  email: string,
  now = Date.now()
): boolean {
  if (rateBuckets.size >= 10_000) {
    for (const [key, bucket] of rateBuckets) {
      if (bucket.resetsAt <= now) rateBuckets.delete(key);
      if (rateBuckets.size < 8_000) break;
    }
    while (rateBuckets.size >= 10_000) {
      const oldest = rateBuckets.keys().next().value as string | undefined;
      if (!oldest) break;
      rateBuckets.delete(oldest);
    }
  }
  // Pair limits avoid one client locking out every user behind a shared proxy.
  const keys = [`attempt:${ip || "unknown"}:${normalizeEmail(email)}`];
  const allowed = keys.every(key => {
    const bucket = rateBuckets.get(key);
    return !bucket || bucket.resetsAt <= now || bucket.count < RATE_LIMIT;
  });
  for (const key of keys) {
    const previous = rateBuckets.get(key);
    if (!previous || previous.resetsAt <= now) {
      rateBuckets.set(key, { count: 1, resetsAt: now + RATE_WINDOW_MS });
    } else {
      previous.count += 1;
    }
  }
  return allowed;
}

export function createAccountPublicUser(user: User) {
  const {
    passwordHash,
    emailNormalized: _emailNormalized,
    ...publicUser
  } = user;
  return { ...publicUser, hasPassword: Boolean(passwordHash) };
}
