/**
 * Cloudflare Workers entry point for the RocketCyber MCP Server.
 *
 * Serves the full MCP server over the Streamable HTTP transport using the SDK's
 * Web Standard transport (Request/Response), which runs natively on Workers.
 * It reuses the exact same `RocketCyberMcpServer` factory as the stdio / Node
 * HTTP entrypoints (via `createServerForRequest()`), so there is no second tool
 * implementation to maintain.
 *
 * Credentials are resolved per request, in order:
 * 1. Gateway headers (when AUTH_MODE=gateway):
 *    - X-RocketCyber-API-Key
 *    - X-RocketCyber-Region (optional; us, eu)
 * 2. Worker secrets / vars (env mode):
 *    - ROCKETCYBER_API_KEY
 *    - ROCKETCYBER_REGION (optional)
 *
 * In gateway mode every /mcp request requires X-RocketCyber-API-Key and does
 * not fall back to ROCKETCYBER_API_KEY. In env mode, tools/list and
 * initialize work without credentials; tools/call requires the env key.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { RocketCyberMcpServer } from "./mcp/server.js";
import { Logger } from "./utils/logger.js";
import type { GatewayCredentials } from "./utils/config.js";
import type { McpServerConfig } from "./types/mcp.js";

export interface Env {
  ROCKETCYBER_API_KEY?: string;
  ROCKETCYBER_REGION?: string;
  AUTH_MODE?: string;
  LOG_LEVEL?: string;
  LOG_FORMAT?: string;
  MCP_SERVER_NAME?: string;
  MCP_SERVER_VERSION?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, X-RocketCyber-API-Key, X-RocketCyber-Region",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers.get(name);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Build the (env-mode) base config + RocketCyberMcpServer instance.
 *
 * The instance itself performs no network I/O at construction — the underlying
 * RocketCyber client is created lazily on the first tool call — so it is cheap
 * to build per request, which keeps the Worker fully stateless.
 */
function buildBaseServer(env: Env): RocketCyberMcpServer {
  const logger = new Logger(
    (env.LOG_LEVEL as "error" | "warn" | "info" | "debug") || "info",
    (env.LOG_FORMAT as "json" | "simple") || "simple"
  );
  const config: McpServerConfig = {
    name: env.MCP_SERVER_NAME || "rocketcyber-mcp",
    version: env.MCP_SERVER_VERSION || "1.0.0",
    rocketcyber: {
      apiKey: env.ROCKETCYBER_API_KEY,
      region: env.ROCKETCYBER_REGION || "us",
    },
  };
  return new RocketCyberMcpServer(config, logger);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Shallow, unauthenticated liveness probe.
    if (url.pathname === "/health" || url.pathname === "/healthz") {
      return json({ status: "ok" });
    }

    if (url.pathname === "/mcp") {
      const isGatewayMode = (env.AUTH_MODE ?? "env") === "gateway";

      let credentials: GatewayCredentials | undefined;
      if (isGatewayMode) {
        const apiKey = headerValue(request, "x-rocketcyber-api-key");
        const region = headerValue(request, "x-rocketcyber-region");
        if (!apiKey) {
          return json(
            {
              error: "Missing credentials",
              message: "Gateway mode requires X-RocketCyber-API-Key header",
              required: ["X-RocketCyber-API-Key"],
            },
            401
          );
        }
        credentials = { apiKey, region };
      }

      const base = buildBaseServer(env);
      const server = base.createServerForRequest(credentials);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport as unknown as Transport);

      try {
        const response = await transport.handleRequest(request);
        return withCors(response);
      } finally {
        await transport.close();
        await server.close();
      }
    }

    return json(
      { error: "Not found", endpoints: ["/mcp", "/health"] },
      404
    );
  },
};
