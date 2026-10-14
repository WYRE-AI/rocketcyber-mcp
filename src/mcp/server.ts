import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { RocketCyberService } from '../services/rocketcyber.service.js';
import { Logger } from '../utils/logger.js';
import { McpServerConfig } from '../types/mcp.js';
import { EnvironmentConfig, parseCredentialsFromHeaders, GatewayCredentials } from '../utils/config.js';
import { RocketCyberResourceHandler } from '../handlers/resource.handler.js';
import { RocketCyberToolHandler } from '../handlers/tool.handler.js';
import { verifyS2sHeader, S2S_HEADER } from './s2s-verify.js';
import { resolveHttpListen } from './http-auth.js';

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class RocketCyberMcpServer {
  private server: Server;
  private config: McpServerConfig;
  private rcService: RocketCyberService;
  private resourceHandler: RocketCyberResourceHandler;
  private toolHandler: RocketCyberToolHandler;
  private logger: Logger;
  private envConfig: EnvironmentConfig | undefined;
  private httpServer?: HttpServer;

  constructor(config: McpServerConfig, logger: Logger, envConfig?: EnvironmentConfig) {
    this.logger = logger;
    this.config = config;
    this.envConfig = envConfig;

    this.rcService = new RocketCyberService(config, logger);
    this.resourceHandler = new RocketCyberResourceHandler(this.rcService, logger);
    this.toolHandler = new RocketCyberToolHandler(this.rcService, logger);

    // Create default server (used for stdio mode)
    this.server = this.createFreshServer();
  }

  /**
   * Create a fresh MCP Server with all handlers registered.
   * Called per-request in HTTP mode so each request gets a clean server.
   *
   * In gateway mode, per-request handlers are passed so each request is fully
   * isolated — no shared mutable state between concurrent requests.
   */
  private createFreshServer(
    perRequestToolHandler?: RocketCyberToolHandler,
    perRequestResourceHandler?: RocketCyberResourceHandler,
  ): Server {
    const server = new Server(
      { name: this.config.name, version: this.config.version },
      {
        capabilities: {
          resources: { subscribe: false, listChanged: true },
          tools: { listChanged: true }
        },
        instructions: this.getServerInstructions()
      }
    );

    server.onerror = (error) => this.logger.error('MCP Server error:', error);
    server.oninitialized = () => this.logger.info('MCP Server initialized and ready');

    this.setupHandlers(
      server,
      perRequestToolHandler ?? this.toolHandler,
      perRequestResourceHandler ?? this.resourceHandler,
    );
    return server;
  }

  /**
   * Build per-request service + handlers from gateway credentials.
   * Returns fully isolated instances that won't be affected by concurrent requests.
   */
  private buildPerRequestHandlers(credentials: GatewayCredentials): {
    toolHandler: RocketCyberToolHandler;
    resourceHandler: RocketCyberResourceHandler;
  } {
    const requestConfig: McpServerConfig = {
      ...this.config,
      rocketcyber: {
        apiKey: credentials.apiKey,
        region: credentials.region ?? this.config.rocketcyber?.region,
      },
    };
    const service = new RocketCyberService(requestConfig, this.logger);
    return {
      resourceHandler: new RocketCyberResourceHandler(service, this.logger),
      toolHandler: new RocketCyberToolHandler(service, this.logger),
    };
  }

  /**
   * Build a fresh, fully-configured MCP `Server` for a single request.
   *
   * This is the transport-agnostic seam reused by the Cloudflare Workers
   * entrypoint (`worker.ts`): the Worker owns its own Web Standard transport
   * and only needs a ready-to-connect `Server`. When `credentials` are
   * provided (gateway mode), per-request isolated handlers are built from them;
   * otherwise the instance's env-configured handlers are used.
   */
  public createServerForRequest(credentials?: GatewayCredentials): Server {
    if (credentials?.apiKey) {
      const { toolHandler, resourceHandler } =
        this.buildPerRequestHandlers(credentials);
      return this.createFreshServer(toolHandler, resourceHandler);
    }
    return this.createFreshServer();
  }

  private setupHandlers(
    server: Server,
    toolHandler: RocketCyberToolHandler,
    resourceHandler: RocketCyberResourceHandler,
  ): void {
    this.logger.info('Setting up MCP request handlers...');

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        const resources = await resourceHandler.listResources();
        return { resources };
      } catch (error) {
        this.logger.error('Failed to list resources:', error);
        throw new McpError(ErrorCode.InternalError, `Failed to list resources: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      try {
        const content = await resourceHandler.readResource(request.params.uri);
        return { contents: [content] };
      } catch (error) {
        this.logger.error(`Failed to read resource ${request.params.uri}:`, error);
        throw new McpError(ErrorCode.InternalError, `Failed to read resource: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      try {
        const tools = await toolHandler.listTools();
        return { tools };
      } catch (error) {
        this.logger.error('Failed to list tools:', error);
        throw new McpError(ErrorCode.InternalError, `Failed to list tools: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const result = await toolHandler.callTool(request.params.name, request.params.arguments || {});
        return { content: result.content, isError: result.isError };
      } catch (error) {
        this.logger.error(`Failed to call tool ${request.params.name}:`, error);
        throw new McpError(ErrorCode.InternalError, `Failed to call tool: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });

    this.logger.info('MCP request handlers set up successfully');
  }

  async start(): Promise<void> {
    const transportType = this.envConfig?.transport?.type || 'stdio';
    this.logger.info(`Starting RocketCyber MCP Server with ${transportType} transport...`);

    if (transportType === 'http') {
      await this.startHttpTransport();
    } else {
      await this.startStdioTransport();
    }
  }

  private async startStdioTransport(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('RocketCyber MCP Server connected to stdio transport');
  }

  /**
   * Start with HTTP Streamable transport.
   * Stateless: each request gets a fresh Server + Transport so multiple
   * clients (via the gateway) never hit "Server already initialized".
   */
  private async startHttpTransport(): Promise<void> {
    // Port 0 is a real bind (ephemeral). `||` would turn it into 8080.
    const configuredPort = this.envConfig?.transport?.port;
    const port = typeof configuredPort === 'number' && Number.isFinite(configuredPort)
      ? configuredPort
      : 8080;
    // Fail closed before listen. Empty and known-placeholder secrets refuse
    // to start. MCP_ALLOW_INSECURE_DEV=1 may skip S2S and always binds
    // 127.0.0.1. A real secret honors MCP_HTTP_HOST (unset stays 0.0.0.0).
    // The secret value is never logged. stdio does not call this path.
    const decision = resolveHttpListen(process.env);
    if (!decision.ok) {
      this.logger.error(decision.message);
      process.exit(1);
    }
    for (const warning of decision.warnings) {
      this.logger.error(warning);
    }
    const host = decision.host;
    const s2sSecret = decision.secret;
    const isGatewayMode = this.envConfig?.auth?.mode === 'gateway';

    this.httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      // Health endpoint — liveness only. No auth, and this handler must not
      // read vendor credentials or the S2S secret.
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          transport: 'http',
          authMode: isGatewayMode ? 'gateway' : 'env',
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // MCP endpoint — stateless: fresh server + transport per request
      if (url.pathname === '/mcp') {
        // Gateway S2S verification (gateway#377 parity). Runs before any
        // credential extraction — see src/mcp/s2s-verify.ts. An empty secret
        // is only reachable when MCP_ALLOW_INSECURE_DEV=1; startup refuses
        // otherwise. A configured secret is always enforced.
        if (s2sSecret && !verifyS2sHeader(headerValue(req.headers[S2S_HEADER]), s2sSecret)) {
          this.logger.warn('Rejected request with missing/invalid gateway S2S header');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Unauthorized',
            message: 'Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.',
          }));
          return;
        }

        // Only POST is supported in stateless mode
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed' },
            id: null,
          }));
          return;
        }

        // In gateway mode, build per-request service + handlers from the
        // injected credential headers. Each request gets its own isolated
        // RocketCyberService so concurrent requests for different tenants
        // never interfere with each other.
        let perRequestToolHandler: RocketCyberToolHandler | undefined;
        let perRequestResourceHandler: RocketCyberResourceHandler | undefined;
        if (isGatewayMode) {
          const credentials = this.extractGatewayCredentials(req);
          if (!credentials.apiKey) {
            this.logger.warn('Gateway mode: Missing required API key in headers');
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Missing credentials',
              message: 'Gateway mode requires X-RocketCyber-API-Key header',
              required: ['X-RocketCyber-API-Key']
            }));
            return;
          }
          const handlers = this.buildPerRequestHandlers(credentials);
          perRequestToolHandler = handlers.toolHandler;
          perRequestResourceHandler = handlers.resourceHandler;
        }

        // Stateless: create fresh server + transport for each request
        const server = this.createFreshServer(perRequestToolHandler, perRequestResourceHandler);
        const transport = new StreamableHTTPServerTransport({
          enableJsonResponse: true,
        });

        res.on('close', () => {
          transport.close();
          server.close();
        });

        server.connect(transport as unknown as Transport).then(() => {
          transport.handleRequest(req, res);
        }).catch((err) => {
          this.logger.error('MCP transport error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal error' },
              id: null,
            }));
          }
        });

        return;
      }

      // 404 for everything else
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health'] }));
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      this.httpServer!.once('error', onError);
      this.httpServer!.listen(port, host, () => {
        this.httpServer!.off('error', onError);
        this.logger.info(`RocketCyber MCP Server listening on http://${host}:${port}/mcp`);
        this.logger.info(`Health check available at http://${host}:${port}/health`);
        this.logger.info(`Authentication mode: ${isGatewayMode ? 'gateway (header-based)' : 'env (environment variables)'}`);
        resolve();
      });
    });
  }

  private extractGatewayCredentials(req: IncomingMessage): GatewayCredentials {
    const headers = req.headers as Record<string, string | string[] | undefined>;
    return parseCredentialsFromHeaders(headers);
  }

  /** Bound HTTP address after a successful HTTP start. */
  getHttpAddress(): AddressInfo | null {
    const address = this.httpServer?.address();
    if (!address || typeof address === 'string') return null;
    return address;
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping RocketCyber MCP Server...');
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => err ? reject(err) : resolve());
      });
    }
    await this.server.close();
    this.logger.info('RocketCyber MCP Server stopped');
  }

  private getServerInstructions(): string {
    return `# RocketCyber MCP Server

This server provides read-only access to RocketCyber Managed SOC data through the Model Context Protocol.

## Available Resources:
- **rocketcyber://account** - Account information
- **rocketcyber://incidents** - Security incidents
- **rocketcyber://agents** - Monitored agents/endpoints

## Available Tools (10 total):
- Account: get account info
- Agents: list monitored agents
- Incidents: list security incidents
- Events: list events, get event summary
- Firewalls: list firewall devices
- Apps: list managed apps
- Defender: get Windows Defender status
- Office: get Office 365 status
- Utility: test connection

## Authentication:
- ROCKETCYBER_API_KEY (required) - Your RocketCyber API key
- ROCKETCYBER_REGION (optional) - API region: us (default) or eu`;
  }
}
