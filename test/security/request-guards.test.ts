import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { normalizeHostname, requestGuards } from "../../src/remote/request-guards.js";

describe("remote request guards", () => {
  const app = express();
  app.use(requestGuards(["photos-mcp.kernelkicks.dev", "localhost", "127.0.0.1", "[::1]"], ["https://photos-mcp.kernelkicks.dev"]));
  app.get("/", (_req, res) => res.sendStatus(204));

  it.each([
    ["PHOTOS-MCP.KERNELKICKS.DEV:443", "photos-mcp.kernelkicks.dev"],
    ["localhost:3000", "localhost"],
    ["[::1]:3000", "[::1]"],
    ["evil.example@localhost", null],
    ["localhost,evil.example", null],
    ["localhost/path", null],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeHostname(input)).toBe(expected);
  });

  it("accepts the configured host and rejects forged forwarded headers", async () => {
    expect((await request(app).get("/").set("Host", "photos-mcp.kernelkicks.dev")).status).toBe(204);
    expect((await request(app).get("/").set("Host", "evil.example").set("X-Forwarded-Host", "photos-mcp.kernelkicks.dev")).status).toBe(403);
    expect((await request(app).get("/").set("Host", "photos-mcp.kernelkicks.dev").set("Origin", "https://evil.example")).status).toBe(403);
    expect((await request(app).get("/").set("Host", "photos-mcp.kernelkicks.dev").set("Origin", "https://photos-mcp.kernelkicks.dev")).status).toBe(204);
  });
});
