import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { setupAuthRoutes } from "../../src/auth/routes.js";

describe("Google OAuth state expiry", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects and consumes an expired state before the cleanup timer runs", async () => {
    const app = express();
    const cleanup = setupAuthRoutes(app);
    try {
      const now = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(now);
      const start = await request(app).get("/auth");
      const state = new URL(start.headers.location).searchParams.get("state");
      expect(state).toBeTruthy();
      clock.mockReturnValue(now + 10 * 60 * 1000);
      const first = await request(app).get("/auth/callback").query({ state, code: "unused" });
      expect(first.status).toBe(400);
      clock.mockReturnValue(now);
      const replay = await request(app).get("/auth/callback").query({ state, code: "unused" });
      expect(replay.status).toBe(400);
    } finally {
      cleanup();
    }
  });
});
