import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { sameOriginMutationGuard } from "./_core/csrf";

function runGuard(method: string, headers: Record<string, string>) {
  let nextCalled = false;
  let statusCode = 200;
  let body: unknown;
  const req = {
    method,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (value: unknown) => {
      body = value;
      return res;
    },
  } as unknown as Response;
  sameOriginMutationGuard(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);
  return { nextCalled, statusCode, body };
}

describe("same-origin API mutation guard", () => {
  it("allows a same-origin write", () => {
    expect(
      runGuard("POST", {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
      }).nextCalled
    ).toBe(true);
  });

  it("blocks a foreign Origin and cross-site fetch", () => {
    expect(
      runGuard("POST", {
        host: "nutrifuel.example",
        origin: "https://attacker.example",
      }).statusCode
    ).toBe(403);
    expect(
      runGuard("POST", {
        host: "nutrifuel.example",
        "sec-fetch-site": "cross-site",
      }).statusCode
    ).toBe(403);
  });

  it("does not reject safe reads", () => {
    expect(
      runGuard("GET", {
        host: "nutrifuel.example",
        origin: "https://attacker.example",
      }).nextCalled
    ).toBe(true);
  });
});
