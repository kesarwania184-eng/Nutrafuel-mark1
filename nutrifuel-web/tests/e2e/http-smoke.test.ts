import { describe, expect, it } from "vitest";

const baseUrl = process.env.NUTRIFIT_E2E_BASE_URL;
const itIfServer = baseUrl ? it : it.skip;

describe("NutriFit running-server smoke flow", () => {
  itIfServer("serves readiness and the complete page route manifest", async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.ok).toBe(true);
    expect(await health.json()).toMatchObject({ status: "ok" });

    const routes = await fetch(`${baseUrl}/manus-routes.json`);
    expect(routes.ok).toBe(true);
    expect(await routes.json()).toEqual({
      routes: [
        { path: "/", title: "NutriFit dashboard" },
        { path: "/404", title: "Not found" },
      ],
    });
  });
});
