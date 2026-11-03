import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type Provider from "oidc-provider";

vi.mock("../../src/remote/google-identity.js", () => ({
  googleAuthorizationUrl: (state: string, nonce: string) => `https://accounts.google.com/?state=${state}&nonce=${nonce}`,
  exchangeGoogleCode: vi.fn(async () => ({ accountId: "google:alice", tokens: { userId: "google:alice" } })),
  saveGoogleCredentials: vi.fn(async () => {}),
}));
import { createInteractionRouter } from "../../src/remote/interactions.js";
import { exchangeGoogleCode, saveGoogleCredentials } from "../../src/remote/google-identity.js";

describe("account linking interactions", () => {
  it("requires CSRF, browser state and a valid original interaction before saving", async () => {
    let valid = true;
    const provider = {
      Client: { find: async () => ({ clientName: "Test" }) },
      interactionDetails: async () => {
        if (!valid) throw new Error("invalid interaction cookie");
        return { uid: "one", params: { client_id: "client" }, prompt: { name: "login", details: {} } };
      },
      interactionFinished: vi.fn(async (_req, res) => res.status(204).end()),
    } as unknown as Provider;
    const app = express().use(createInteractionRouter(provider, "https://example.test"));
    const form = await request(app).get("/interaction/one");
    const csrf = form.text.match(/name="csrf" value="([^"]+)"/)?.[1];
    expect(csrf).toBeTruthy();
    expect((await request(app).post("/interaction/one/login").type("form").send({ csrf })).status).toBe(400);
    const start = await request(app).post("/interaction/one/login").set("Origin", "https://example.test").type("form").send({ csrf });
    expect(start.status).toBe(303);
    const state = new URL(start.headers.location).searchParams.get("state");
    const stateCookie = (start.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
    expect((await request(app).get("/auth/callback").query({ state, code: "code" })).status).toBe(400);
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
    const callback = await request(app).get("/auth/callback").set("Cookie", stateCookie).query({ state, code: "code" });
    expect(callback.status).toBe(303);
    expect((await request(app).get("/auth/callback").set("Cookie", stateCookie).query({ state, code: "code" })).status).toBe(400);
    const ticketCookie = (callback.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
    valid = false;
    expect((await request(app).get(callback.headers.location).set("Cookie", ticketCookie)).status).toBe(500);
    expect(saveGoogleCredentials).not.toHaveBeenCalled();
    valid = true;
    expect((await request(app).get(callback.headers.location).set("Cookie", ticketCookie)).status).toBe(204);
    expect(saveGoogleCredentials).toHaveBeenCalledOnce();
    expect((await request(app).get(callback.headers.location).set("Cookie", ticketCookie)).status).toBe(400);
  });
});
