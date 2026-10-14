/**
 * HTTP transport fail-closed service-to-service auth (CWE-306).
 *
 * An empty CONDUIT_S2S_SECRET used to skip the X-Gateway-S2S check. Startup
 * now refuses to listen unless the secret is set and is not a known
 * placeholder. MCP_ALLOW_INSECURE_DEV=1 is the only bypass: it logs a
 * warning, does not enforce S2S, and binds 127.0.0.1 only. A non-loopback
 * MCP_HTTP_HOST is overridden in that mode.
 *
 * A real secret honors MCP_HTTP_HOST. When that variable is unset the
 * process keeps the historical 0.0.0.0 bind. The secret value is never logged.
 *
 * stdio does not call this. /health stays unauthenticated.
 */

/** Public example values. A copied placeholder must not verify as a real secret. */
export const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'replace-with-a-real-secret',
  'your-s2s-secret',
  'your-secret',
  'changeme',
  'change-me',
  'placeholder',
  'secret',
  'example',
  'replace-me',
  's2s-secret',
]);

export const LOOPBACK_HOST = '127.0.0.1';

const MISSING_S2S_SECRET_ERROR =
  'Refusing to start HTTP transport: CONDUIT_S2S_SECRET is empty. ' +
  'Set CONDUIT_S2S_SECRET to the gateway-provisioned secret (openssl rand -hex 32), ' +
  'or set MCP_ALLOW_INSECURE_DEV=1 for local development only.';

const PLACEHOLDER_S2S_SECRET_ERROR =
  'Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder. ' +
  'Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value. ' +
  'MCP_ALLOW_INSECURE_DEV=1 does not accept a placeholder secret.';

export const INSECURE_DEV_WARNING =
  'SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. ' +
  'HTTP /mcp is starting with service-to-service authentication DISABLED, bound to 127.0.0.1 only. ' +
  'Local development only; do not expose this port.';

export type HttpListenDecision =
  | {
      ok: true;
      secret: string;
      host: string;
      insecureDev: boolean;
      warnings: string[];
    }
  | { ok: false; message: string };

/** 127.0.0.1, the rest of 127.0.0.0/8, localhost, and ::1. */
export function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.+)\]$/, '$1');
  if (normalized === 'localhost' || normalized === '::1') return true;
  const bare = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized;
  const parts = bare.split('.');
  if (parts.length !== 4) return false;
  if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  return parts[0] === '127';
}

/**
 * Fail closed. A known placeholder is never a configured secret, including
 * when MCP_ALLOW_INSECURE_DEV=1 is also set. Empty is the only case the dev
 * flag may bypass, and that bypass does not check X-Gateway-S2S.
 *
 * No real secret forces 127.0.0.1, even when MCP_HTTP_HOST is 0.0.0.0.
 * A real secret honors MCP_HTTP_HOST; unset stays 0.0.0.0.
 * Never include the secret value in a message or warning.
 */
export function resolveHttpListen(env: NodeJS.ProcessEnv = process.env): HttpListenDecision {
  const raw = (env.CONDUIT_S2S_SECRET ?? '').trim();
  if (raw && KNOWN_PLACEHOLDER_SECRETS.has(raw.toLowerCase())) {
    return { ok: false, message: PLACEHOLDER_S2S_SECRET_ERROR };
  }

  const configuredHost = (env.MCP_HTTP_HOST ?? '').trim();
  if (!raw) {
    if (env.MCP_ALLOW_INSECURE_DEV !== '1') {
      return { ok: false, message: MISSING_S2S_SECRET_ERROR };
    }

    const warnings = [INSECURE_DEV_WARNING];
    if (configuredHost && !isLoopbackBindHost(configuredHost)) {
      warnings.push(
        `MCP_HTTP_HOST=${configuredHost} is not a loopback address. ` +
          'MCP_ALLOW_INSECURE_DEV=1 without CONDUIT_S2S_SECRET cannot listen there. ' +
          `Binding ${LOOPBACK_HOST} only.`,
      );
    }
    return {
      ok: true,
      secret: '',
      host: LOOPBACK_HOST,
      insecureDev: true,
      warnings,
    };
  }

  return {
    ok: true,
    secret: raw,
    host: configuredHost || '0.0.0.0',
    insecureDev: false,
    warnings: [],
  };
}
