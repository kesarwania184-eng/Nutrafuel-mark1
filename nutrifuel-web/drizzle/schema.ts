import {
  int,
  index,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable(
  "users",
  {
    /**
     * Surrogate primary key. Auto-incremented numeric value managed by the database.
     * Use this for relations between tables.
     */
    id: int("id").autoincrement().primaryKey(),
    /** Stable account identifier used to scope local and server-side nutrition data. */
    openId: varchar("openId", { length: 64 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    /** Normalized email is unique for first-party email/password accounts. */
    emailNormalized: varchar("emailNormalized", { length: 320 }),
    passwordHash: varchar("passwordHash", { length: 255 }),
    loginMethod: varchar("loginMethod", { length: 64 }),
    role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  table => ({
    emailNormalizedUnique: uniqueIndex("users_emailNormalized_unique").on(
      table.emailNormalized
    ),
  })
);

export const authSessions = mysqlTable(
  "auth_sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 digest only; the browser receives the random opaque token. */
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tokenHashUnique: uniqueIndex("auth_sessions_tokenHash_unique").on(
      table.tokenHash
    ),
    userIdIndex: index("auth_sessions_userId_idx").on(table.userId),
  })
);

/** One durable, versioned, private snapshot per authenticated user. */
export const userNutritionData = mysqlTable("user_nutrition_data", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  snapshot: mediumtext("snapshot").notNull(),
  revision: int("revision").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type UserNutritionData = typeof userNutritionData.$inferSelect;
export type InsertUserNutritionData = typeof userNutritionData.$inferInsert;
