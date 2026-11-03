import { Router } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { GooglePhotosMCPCore } from "../mcp/core.js";
import type { TokenData } from "../auth/tokens.js";
import type { McpPrincipal } from "./bearer-auth.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  principal: McpPrincipal;
  lastActivity: number;
}

/** Must be mounted after bearerAuth and the JSON body parser. */
export function createRemoteMcpTransport(resolveTokens: (accountId: string) => Promise<TokenData | null>) {
  const router = Router();
  const sessions = new Map<string, Session>();
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, session] of sessions) {
      if (session.lastActivity < cutoff) {
        sessions.delete(id);
        void session.transport.close();
      }
    }
  }, 60_000);
  cleanup.unref();

  router.all("/", async (req, res) => {
    const principal = res.locals.mcpPrincipal as McpPrincipal | undefined;
    if (!principal?.accountId || !principal.clientId) return void res.sendStatus(401);
    const sessionId = req.get("mcp-session-id");
    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (session && (session.principal.accountId !== principal.accountId || session.principal.clientId !== principal.clientId)) {
      return void res.status(404).send("Session not found");
    }
    if (!session && !sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
      if (sessions.size >= 1000) return void res.status(503).send("Session capacity reached");
      const core = new GooglePhotosMCPCore({ name: "google-photos-mcp", version: "0.1.0" }, {
        tokenResolver: () => resolveTokens(principal.accountId), allowLocalAuthentication: false, allowLocalFiles: false,
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => { sessions.set(id, created); },
        onsessionclosed: (id) => { sessions.delete(id); },
      });
      const created: Session = { transport, principal, lastActivity: Date.now() };
      transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
      await core.getServer().connect(transport);
      session = created;
    }
    if (!session) return void res.status(404).send("Session not found");
    session.lastActivity = Date.now();
    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).send("MCP request failed");
    }
  });

  return {
    router,
    async close() {
      clearInterval(cleanup);
      await Promise.allSettled([...sessions.values()].map((session) => session.transport.close()));
      sessions.clear();
    },
  };
}
