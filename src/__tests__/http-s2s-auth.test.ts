/**
 * HTTP transport fail-closed auth (CWE-306).
 *
 * Startup requires a real CONDUIT_S2S_SECRET. Empty and known placeholders
 * refuse to listen. MCP_ALLOW_INSECURE_DEV=1 is the empty-secret bypass: it
 * binds 127.0.0.1 only, including when MCP_HTTP_HOST is a wider address.
 * A configured secret honors MCP_HTTP_HOST (unset stays 0.0.0.0).
 * /mcp rejects a missing or invalid X-Gateway-S2S header.
 * AUTH_MODE=gateway rejects requests that omit X-RocketCyber-API-Key and
 * must not fall back to ROCKETCYBER_API_KEY in process.env.
 */

import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RocketCyberMcpServer } from '../mcp/server.js';
import { Logger } from '../utils/logger.js';
import { loadEnvironmentConfig, mergeWithMcpConfig } from '../utils/config.js';

const clientState = vi.hoisted(() => ({
  calls: [] as Array<{ apiKey: string; region?: string }>,
}));

vi.mock('@wyre-ai/node-rocketcyber', () => {
  class RocketCyberClient {
    account: { get: () => Promise<{ id: number; name: string }> };

    constructor(config: { apiKey: string; region?: string }) {
      clientState.calls.push({ apiKey: config.apiKey, region: config.region });
      this.account = { get: async () => ({ id: 1, name: 'tenant' }) };
    }
  }
  return { RocketCyberClient };
});

const S2S_SECRET = 's2s-do-not-log-7f3a9c';
const ENV_API_KEY = 'env-api-key-must-not-be-used';

const ENV_KEYS = [
  'CONDUIT_S2S_SECRET',
  'MCP_ALLOW_INSECURE_DEV',
  'MCP_HTTP_PORT',
  'MCP_HTTP_HOST',
  'AUTH_MODE',
  'ROCKETCYBER_API_KEY',
  'ROCKETCYBER_REGION',
  'LOG_LEVEL',
  'MCP_TRANSPORT',
] as const;

const savedEnv = new Map<string, string | undefined>();
const servers: RocketCyberMcpServer[] = [];

function mintS2sHeader(secret: string, unixSeconds = Math.floor(Date.now() / 1000)): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac('sha256', secret).update(message).digest('hex');
  return `${message},v1=${hex}`;
}

function captureStderr(): { text: () => string; restore: () => void } {
  const chunks: string[] = [];
  const streams = new Set<NodeJS.WriteStream>([process.stderr]);
  const consoleStderr = (console as unknown as { _stderr?: NodeJS.WriteStream })._stderr;
  if (consoleStderr) streams.add(consoleStderr);
  const originals = [...streams].map((stream) => ({
    stream,
    write: stream.write,
  }));
  const replacement: typeof process.stderr.write = function write(chunk, encoding, cb) {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    if (typeof encoding === 'function') encoding();
    else if (typeof cb === 'function') cb();
    return true;
  };
  for (const { stream } of originals) stream.write = replacement;
  return {
    text: () => chunks.join(''),
    restore: () => {
      for (const { stream, write } of originals) stream.write = write;
    },
  };
}

function assertNoSecrets(logged: string, extra: string[] = []): void {
  expect(logged).not.toContain(S2S_SECRET);
  expect(logged).not.toContain(ENV_API_KEY);
  for (const value of extra) expect(logged).not.toContain(value);
}

interface HttpResult {
  status: number;
  body: string;
}

function sendHttp(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers };
    if (options.body !== undefined) {
      headers['content-length'] = String(Buffer.byteLength(options.body));
    }
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: options.port,
        method: options.method,
        path: options.path,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.setTimeout(5000, () => {
      req.destroy(new Error(`timeout ${options.method} ${options.path}`));
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      reject(new Error(`${err.code ?? ''} ${err.message} port=${options.port}`));
    });
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function mcpHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...extra,
  };
}

const accountCall = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'rocketcyber_get_account', arguments: {} },
});

async function boot(): Promise<{ server: RocketCyberMcpServer; port: number; address: string }> {
  const envConfig = loadEnvironmentConfig();
  const server = new RocketCyberMcpServer(mergeWithMcpConfig(envConfig), new Logger('error'), envConfig);
  servers.push(server);
  await server.start();
  const bound = server.getHttpAddress();
  if (!bound) throw new Error('HTTP server did not bind a TCP port');
  return { server, port: bound.port, address: bound.address };
}

function mockExit(): void {
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${String(code)}`);
  }) as typeof process.exit);
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
  }
  clientState.calls.length = 0;
  process.env.MCP_TRANSPORT = 'http';
  process.env.MCP_HTTP_PORT = '0';
  process.env.MCP_HTTP_HOST = '127.0.0.1';
  process.env.LOG_LEVEL = 'error';
  delete process.env.CONDUIT_S2S_SECRET;
  delete process.env.MCP_ALLOW_INSECURE_DEV;
  delete process.env.AUTH_MODE;
  delete process.env.ROCKETCYBER_API_KEY;
  delete process.env.ROCKETCYBER_REGION;
});

afterEach(async () => {
  vi.restoreAllMocks();
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) continue;
    await server.stop();
  }
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('HTTP startup', () => {
  it('refuses to start when CONDUIT_S2S_SECRET is empty', async () => {
    const logs = captureStderr();
    mockExit();
    try {
      await expect(boot()).rejects.toThrow('process.exit:1');
      const text = logs.text();
      expect(text).toContain('Refusing to start HTTP transport');
      expect(text).toContain('CONDUIT_S2S_SECRET is empty');
      assertNoSecrets(text);
    } finally {
      logs.restore();
    }
  });

  it('still refuses when MCP_ALLOW_INSECURE_DEV is not exactly 1', async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = 'true';
    process.env.CONDUIT_S2S_SECRET = '   ';
    const logs = captureStderr();
    mockExit();
    try {
      await expect(boot()).rejects.toThrow('process.exit:1');
      expect(logs.text()).toContain('Refusing to start HTTP transport');
      expect(logs.text()).toContain('CONDUIT_S2S_SECRET is empty');
    } finally {
      logs.restore();
    }
  });

  it.each(['changeme', 'CHANGE-ME', ' your-s2s-secret ', 'replace-me', 's2s-secret', 'secret'])(
    'refuses a known placeholder secret (%s) even with the dev bypass',
    async (placeholder) => {
      process.env.CONDUIT_S2S_SECRET = placeholder;
      process.env.MCP_ALLOW_INSECURE_DEV = '1';
      process.env.MCP_HTTP_HOST = '0.0.0.0';
      const logs = captureStderr();
      mockExit();
      try {
        await expect(boot()).rejects.toThrow('process.exit:1');
        const text = logs.text();
        expect(text).toContain('Refusing to start HTTP transport');
        expect(text).toContain('known placeholder');
        // The static error text contains the word "secret". Other placeholder
        // values must not be echoed.
        if (placeholder.trim().toLowerCase() !== 'secret') {
          expect(text).not.toContain(placeholder.trim());
        }
        assertNoSecrets(text);
      } finally {
        logs.restore();
      }
    },
  );

  it('allows startup with a warning when MCP_ALLOW_INSECURE_DEV=1 and binds 127.0.0.1', async () => {
    delete process.env.MCP_HTTP_HOST;
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    const logs = captureStderr();
    try {
      const server = await boot();
      expect(server.address).toBe('127.0.0.1');
      const text = logs.text();
      expect(text).toContain('SECURITY WARNING');
      expect(text).toContain('CONDUIT_S2S_SECRET is empty');
      expect(text).toContain('MCP_ALLOW_INSECURE_DEV=1');
      expect(text).toContain('127.0.0.1');
      expect(text).not.toContain('not a loopback address');
      assertNoSecrets(text);
    } finally {
      logs.restore();
    }
  });

  it('forces 127.0.0.1 when the dev bypass is set and MCP_HTTP_HOST is non-loopback', async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    const logs = captureStderr();
    try {
      const server = await boot();
      expect(server.address).toBe('127.0.0.1');
      const text = logs.text();
      expect(text).toContain('MCP_HTTP_HOST=0.0.0.0 is not a loopback address');
      expect(text).toContain('Binding 127.0.0.1 only');
      assertNoSecrets(text);
    } finally {
      logs.restore();
    }
  });

  it('honors a non-loopback MCP_HTTP_HOST when CONDUIT_S2S_SECRET is set', async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    const logs = captureStderr();
    try {
      const server = await boot();
      expect(server.address).toBe('0.0.0.0');
      expect(logs.text()).not.toContain('not a loopback address');
      assertNoSecrets(logs.text());
    } finally {
      logs.restore();
    }
  });

  it('keeps the historical 0.0.0.0 bind when the secret is set and MCP_HTTP_HOST is unset', async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    delete process.env.MCP_HTTP_HOST;
    const server = await boot();
    expect(server.address).toBe('0.0.0.0');
  });
});

describe('HTTP /mcp authentication', () => {
  beforeEach(() => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.AUTH_MODE = 'gateway';
    process.env.ROCKETCYBER_API_KEY = ENV_API_KEY;
    process.env.ROCKETCYBER_REGION = 'us';
    process.env.MCP_HTTP_HOST = '127.0.0.1';
  });

  it('returns 401 when the S2S header is missing or invalid and does not log the secret', async () => {
    const logs = captureStderr();
    try {
      const server = await boot();
      const missing = await sendHttp({
        port: server.port,
        method: 'POST',
        path: '/mcp',
        headers: mcpHeaders({
          'x-rocketcyber-api-key': 'header-api-key',
        }),
        body: accountCall,
      });
      const invalid = await sendHttp({
        port: server.port,
        method: 'POST',
        path: '/mcp',
        headers: mcpHeaders({
          'x-gateway-s2s': mintS2sHeader('wrong-secret'),
          'x-rocketcyber-api-key': 'header-api-key',
        }),
        body: accountCall,
      });

      expect(missing.status).toBe(401);
      expect(invalid.status).toBe(401);
      expect(missing.body).toContain('X-Gateway-S2S');
      expect(invalid.body).toContain('X-Gateway-S2S');
      expect(missing.body).not.toContain(S2S_SECRET);
      expect(invalid.body).not.toContain(S2S_SECRET);
      expect(missing.body).not.toContain(ENV_API_KEY);
      assertNoSecrets(logs.text());
      expect(clientState.calls).toEqual([]);
    } finally {
      logs.restore();
    }
  });

  it('returns 401 in gateway mode without credential headers and does not use env credentials', async () => {
    const server = await boot();
    const response = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({ 'x-gateway-s2s': mintS2sHeader(S2S_SECRET) }),
      body: accountCall,
    });
    const blank = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({
        'x-gateway-s2s': mintS2sHeader(S2S_SECRET),
        'x-rocketcyber-api-key': '   ',
      }),
      body: accountCall,
    });

    expect(response.status).toBe(401);
    expect(blank.status).toBe(401);
    expect(response.body).toContain('Missing credentials');
    expect(response.body).toContain('X-RocketCyber-API-Key');
    expect(response.body).not.toContain(ENV_API_KEY);
    expect(response.body).not.toContain(S2S_SECRET);
    expect(blank.body).not.toContain(ENV_API_KEY);
    expect(clientState.calls).toEqual([]);
  });

  it('accepts a valid S2S header plus credential headers and uses those credentials', async () => {
    const logs = captureStderr();
    try {
      const server = await boot();
      const response = await sendHttp({
        port: server.port,
        method: 'POST',
        path: '/mcp',
        headers: mcpHeaders({
          'x-gateway-s2s': mintS2sHeader(S2S_SECRET),
          'x-rocketcyber-api-key': 'header-api-key',
          'x-rocketcyber-region': 'eu',
        }),
        body: accountCall,
      });

      expect(response.status).toBe(200);
      expect(response.body).not.toContain(S2S_SECRET);
      expect(response.body).not.toContain(ENV_API_KEY);
      expect(response.body).toContain('tenant');
      expect(clientState.calls).toEqual([{ apiKey: 'header-api-key', region: 'eu' }]);
      assertNoSecrets(logs.text(), ['header-api-key']);
    } finally {
      logs.restore();
    }
  });

  it('serves /health without authentication and without reading credentials', async () => {
    const server = await boot();
    const response = await sendHttp({
      port: server.port,
      method: 'GET',
      path: '/health',
    });
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as { status?: string; authMode?: string };
    expect(body.status).toBe('ok');
    expect(body.authMode).toBe('gateway');
    expect(response.body).not.toContain(S2S_SECRET);
    expect(response.body).not.toContain(ENV_API_KEY);
    expect(clientState.calls).toEqual([]);
  });

  it('uses env credentials in AUTH_MODE=env after a valid S2S header', async () => {
    process.env.AUTH_MODE = 'env';
    const server = await boot();
    const response = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({ 'x-gateway-s2s': mintS2sHeader(S2S_SECRET) }),
      body: accountCall,
    });
    expect(response.status).toBe(200);
    expect(clientState.calls).toEqual([{ apiKey: ENV_API_KEY, region: 'us' }]);
    expect(response.body).not.toContain(S2S_SECRET);
  });

  it('skips X-Gateway-S2S only for the loopback dev bypass', async () => {
    delete process.env.CONDUIT_S2S_SECRET;
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.MCP_HTTP_HOST = '10.1.2.3';
    const logs = captureStderr();
    try {
      const server = await boot();
      expect(server.address).toBe('127.0.0.1');
      const response = await sendHttp({
        port: server.port,
        method: 'POST',
        path: '/mcp',
        headers: mcpHeaders({
          'x-rocketcyber-api-key': 'header-api-key',
          'x-rocketcyber-region': 'eu',
        }),
        body: accountCall,
      });
      expect(response.status).toBe(200);
      expect(response.body).not.toContain('X-Gateway-S2S');
      expect(clientState.calls).toEqual([{ apiKey: 'header-api-key', region: 'eu' }]);
      expect(logs.text()).toContain('SECURITY WARNING');
      assertNoSecrets(logs.text(), ['header-api-key']);
    } finally {
      logs.restore();
    }
  });
});
