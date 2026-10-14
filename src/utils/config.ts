import { McpServerConfig } from '../types/mcp.js';
import { LogLevel } from './logger.js';

export type TransportType = 'stdio' | 'http';
export type AuthMode = 'env' | 'gateway';

/**
 * Gateway credentials extracted from HTTP request headers.
 * The MCP Gateway injects credentials via these headers:
 * - X-RocketCyber-API-Key: Contains the RocketCyber API key
 * - X-RocketCyber-Region: Contains the RocketCyber region (us or eu)
 */
export interface GatewayCredentials {
  apiKey: string | undefined;
  region: string | undefined;
}

export interface EnvironmentConfig {
  rocketcyber: {
    apiKey?: string;
    region?: string;
  };
  server: {
    name: string;
    version: string;
  };
  transport: {
    type: TransportType;
    port: number;
    host: string;
  };
  logging: {
    level: LogLevel;
    format: 'json' | 'simple';
  };
  auth: {
    mode: AuthMode;
  };
}

/**
 * Parse credentials from HTTP request headers (for per-request credential handling).
 * Header names follow HTTP convention (lowercase with hyphens).
 */
export function parseCredentialsFromHeaders(
  headers: Record<string, string | string[] | undefined>
): GatewayCredentials {
  const getHeader = (name: string): string | undefined => {
    const value = headers[name] || headers[name.toLowerCase()];
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  return {
    apiKey: getHeader('x-rocketcyber-api-key'),
    region: getHeader('x-rocketcyber-region'),
  };
}

export function loadEnvironmentConfig(): EnvironmentConfig {
  const transportType = (process.env.MCP_TRANSPORT as TransportType) || 'stdio';
  if (transportType !== 'stdio' && transportType !== 'http') {
    throw new Error(`Invalid MCP_TRANSPORT value: "${transportType}". Must be "stdio" or "http".`);
  }

  const authMode = (process.env.AUTH_MODE as AuthMode) || 'env';

  return {
    rocketcyber: {
      apiKey: process.env.ROCKETCYBER_API_KEY,
      region: process.env.ROCKETCYBER_REGION || 'us',
    },
    server: {
      name: process.env.MCP_SERVER_NAME || 'rocketcyber-mcp',
      version: process.env.MCP_SERVER_VERSION || '1.0.0'
    },
    transport: {
      type: transportType,
      port: parseInt(process.env.MCP_HTTP_PORT || '8080', 10),
      // Historical bind when MCP_HTTP_HOST is unset. HTTP startup
      // (src/mcp/http-auth.ts) forces 127.0.0.1 when there is no real
      // CONDUIT_S2S_SECRET. A configured secret honors this value.
      host: process.env.MCP_HTTP_HOST || '0.0.0.0'
    },
    logging: {
      level: (process.env.LOG_LEVEL as LogLevel) || 'info',
      format: (process.env.LOG_FORMAT as 'json' | 'simple') || 'simple'
    },
    auth: {
      mode: authMode
    }
  };
}

export function mergeWithMcpConfig(envConfig: EnvironmentConfig): McpServerConfig {
  return {
    name: envConfig.server.name,
    version: envConfig.server.version,
    rocketcyber: {
      apiKey: envConfig.rocketcyber.apiKey,
      region: envConfig.rocketcyber.region,
    }
  };
}
