import { describe, expect, it } from "vitest";
import type { User } from "../drizzle/schema";
import {
  consumeAuthRateLimit,
  createAccountPublicUser,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from "./accountAuth";

describe("account authentication helpers", () => {
  it("normalizes email before account lookup", () => {
    expect(normalizeEmail("  Person.Name+tag@Example.COM ")).toBe(
      "person.name+tag@example.com"
    );
  });

  it("stores password material as a salted scrypt hash", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    await expect(
      verifyPassword("correct horse battery staple", first)
    ).resolves.toBe(true);
    await expect(verifyPassword("incorrect password", first)).resolves.toBe(
      false
    );
    await expect(verifyPassword("anything", "broken-hash")).resolves.toBe(
      false
    );
  });

  it("does not expose password hashes or normalized lookup keys to the browser", () => {
    const user = {
      id: 7,
      openId: "email_user",
      name: "Member",
      email: "member@example.com",
      emailNormalized: "member@example.com",
      passwordHash: "secret-hash",
      loginMethod: "email",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as User;
    const safe = createAccountPublicUser(user);
    expect(safe).not.toHaveProperty("passwordHash");
    expect(safe).not.toHaveProperty("emailNormalized");
    expect(safe.email).toBe("member@example.com");
  });

  it("limits repeated sign-in attempts and releases the bucket after the window", () => {
    const ip = "test-ip-auth-rate-limit";
    const email = "limited@example.com";
    const start = 2_000_000_000_000;
    for (let index = 0; index < 10; index++) {
      expect(consumeAuthRateLimit(ip, email, start + index)).toBe(true);
    }
    expect(consumeAuthRateLimit(ip, email, start + 20)).toBe(false);
    expect(consumeAuthRateLimit(ip, email, start + 16 * 60 * 1000)).toBe(true);
  });
});
