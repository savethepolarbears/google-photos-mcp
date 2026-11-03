import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createRemoteMcpTransport } from "../../src/remote/mcp-transport.js";

describe("remote MCP session isolation", () => {
  const servers: Array<ReturnType<typeof createRemoteMcpTransport>> = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

  it("initializes, lists tools and prevents another account or client using a session", async () => {
    const resolver = vi.fn().mockResolvedValue(null);
    const mcp = createRemoteMcpTransport(resolver);
    servers.push(mcp);
    const app = express();
    app.use(express.json());
    // Authentication itself is tested separately; these headers simulate its verified result.
    app.use((req, res, next) => { res.locals.mcpPrincipal = { accountId: req.get("test-account"), clientId: req.get("test-client") }; next(); });
    app.use("/mcp", mcp.router);
    const initialize = await request(app).post("/mcp").set("test-account", "alice").set("test-client", "client-a")
      .set("Accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(initialize.status).toBe(200);
    const session = initialize.headers["mcp-session-id"];
    expect(session).toBeTruthy();
    const tools = await request(app).post("/mcp").set("test-account", "alice").set("test-client", "client-a")
      .set("mcp-session-id", session).set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(tools.status).toBe(200);
    expect(tools.text).toContain("search_photos");
    expect(tools.text).not.toContain('"name":"upload_media"');
    for (const [account, client] of [["bob", "client-a"], ["alice", "client-b"]]) {
      for (const method of ["get", "post", "delete"] as const) {
        const result = await request(app)[method]("/mcp").set("test-account", account).set("test-client", client)
          .set("mcp-session-id", session).set("Accept", "application/json, text/event-stream");
        expect(result.status).toBe(404);
      }
    }
    const call = await request(app).post("/mcp").set("test-account", "alice").set("test-client", "client-a")
      .set("mcp-session-id", session).set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "auth_status", arguments: {} } });
    expect(call.status).toBe(200);
    expect(resolver).toHaveBeenCalledWith("alice");
    expect(resolver).not.toHaveBeenCalledWith("bob");
  });
});
