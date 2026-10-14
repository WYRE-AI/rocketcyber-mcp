# rocketcyber-mcp

MCP (Model Context Protocol) server for the [RocketCyber](https://www.rocketcyber.com/) Managed SOC platform. Provides read-only access to RocketCyber security data through 10 tools and 3 resources.

## Features

- 10 read-only tools covering all RocketCyber API resources, each annotated `readOnlyHint: true` so MCP clients (e.g. Microsoft 365 Copilot) can skip per-call confirmation prompts
- 3 MCP resources for quick data access
- Dual transport: stdio (default) and HTTP Streamable
- Lazy SDK initialization on first tool call
- Winston logger with all output routed to stderr
- Connection test tool for validating credentials

## One-Click Deployment

> [!IMPORTANT]
> **Before you click:** this server depends on `@wyre-ai/node-rocketcyber`,
> which is hosted on the **GitHub Packages** npm registry. GitHub Packages has no
> anonymous access — even though the package is public, every `npm install` needs a
> token. The cloud builder runs `npm install` for you, so you must give it one, or
> the build fails with `npm error 401 Unauthorized ... npm.pkg.github.com`.
>
> 1. Create a GitHub **Personal Access Token** with the `read:packages` scope
>    ([classic token](https://github.com/settings/tokens/new?scopes=read:packages&description=rocketcyber-mcp%20deploy)).
>    Any GitHub account works — you do **not** need to be a member of the
>    `WYRE-AI` org to read its public packages.
> 2. Add it as a build variable when prompted by the deploy flow:
>    - **Cloudflare Workers** → set a build variable named **`NODE_AUTH_TOKEN`** to your PAT
>      (Workers → Settings → Build → Variables and Secrets).
>    - **DigitalOcean App Platform** → set an encrypted env var named **`GITHUB_TOKEN`**
>      with scope **Build Time** to your PAT (the Dockerfile reads it for the install).

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/WYRE-AI/rocketcyber-mcp/tree/main)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/WYRE-AI/rocketcyber-mcp)

## Installation

This project depends on `@wyre-ai/node-rocketcyber`, published to the
**GitHub Packages** npm registry, which requires a token even for public packages.
Authenticate once, then install:

```bash
# Authenticate npm to GitHub Packages (token needs the read:packages scope)
export NODE_AUTH_TOKEN=$(gh auth token)   # or a PAT with read:packages

npm install
npm run build
```

The repo's `.npmrc` already points the `@wyre-ai` scope at GitHub Packages and
reads the token from `NODE_AUTH_TOKEN`, so no further config is needed.

## Configuration

Copy [`.env.example`](.env.example) and set the variables below.

| Environment Variable | Required | Default | Description |
|---|---|---|---|
| `ROCKETCYBER_API_KEY` | For stdio and `AUTH_MODE=env` | - | RocketCyber API key |
| `ROCKETCYBER_REGION` | No | `us` | API region: `us` or `eu` |
| `MCP_TRANSPORT` | No | `stdio` | Transport type: `stdio` or `http` |
| `AUTH_MODE` | No | `env` (image and Compose set `gateway`) | `gateway` requires `X-RocketCyber-API-Key` on each `/mcp` request and never falls back to `ROCKETCYBER_*`. `env` uses those variables only after S2S auth succeeds. |
| `CONDUIT_S2S_SECRET` | Yes for HTTP | - | Service-to-service secret. The HTTP server logs an error and exits non-zero when this is empty or a known placeholder (`changeme`, `secret`, `replace-me`, `your-s2s-secret`, and the other example values). Generate one with `openssl rand -hex 32`. Compose will not start without it. The value is never logged. |
| `MCP_ALLOW_INSECURE_DEV` | No | - | Set to exactly `1` only for local development to start HTTP without `CONDUIT_S2S_SECRET`. The process logs a warning, does not enforce `X-Gateway-S2S`, and binds `127.0.0.1` only. A non-loopback `MCP_HTTP_HOST` is overridden. A known placeholder secret still refuses to start. |
| `MCP_HTTP_PORT` | No | `8080` | HTTP port (when using http transport) |
| `MCP_HTTP_HOST` | No | `0.0.0.0` when a real secret is set | Bind address when `CONDUIT_S2S_SECRET` is set. Unset keeps `0.0.0.0`. Without a secret, the dev bypass ignores this and binds `127.0.0.1`. The container image sets `0.0.0.0`. |
| `LOG_LEVEL` | No | `info` | Log level: `error`, `warn`, `info`, `debug` |
| `LOG_FORMAT` | No | `simple` | Log format: `json` or `simple` |

`/health` stays unauthenticated and does not read credentials. The stdio transport does not use `CONDUIT_S2S_SECRET`.

### HTTP authentication

With `MCP_TRANSPORT=http` and a real `CONDUIT_S2S_SECRET`, every `/mcp` request must include `X-Gateway-S2S`. The check is `verifyS2sHeader` in [`src/mcp/s2s-verify.ts`](src/mcp/s2s-verify.ts): the header value is `t=<unix seconds>,v1=<hex>`, where the hex is HMAC-SHA256 of the literal string `t=<unix seconds>` keyed with `CONDUIT_S2S_SECRET` (64 lowercase hex characters). The timestamp must be within 300 seconds of the server clock. A missing or invalid header is HTTP 401, before vendor credentials are read.

```bash
TS=$(date +%s)
SIG=$(printf 't=%s' "$TS" | openssl dgst -sha256 -hmac "$CONDUIT_S2S_SECRET" -hex | awk '{print $NF}')
curl -sS http://127.0.0.1:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "X-Gateway-S2S: t=${TS},v1=${SIG}" \
  -H "X-RocketCyber-API-Key: $ROCKETCYBER_API_KEY" \
  -H "X-RocketCyber-Region: us" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

In `AUTH_MODE=gateway`, `/mcp` also requires `X-RocketCyber-API-Key` (`X-RocketCyber-Region` is optional). That header is the only credential source for the request. A missing or blank API key is HTTP 401 and does not fall back to `ROCKETCYBER_API_KEY`. `AUTH_MODE=env` still requires the signed `X-Gateway-S2S` header, then uses `ROCKETCYBER_API_KEY` from the environment.

## Usage

### Claude Desktop (stdio)

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rocketcyber": {
      "command": "node",
      "args": ["/path/to/rocketcyber-mcp/dist/entry.js"],
      "env": {
        "ROCKETCYBER_API_KEY": "your-api-key"
      }
    }
  }
}
```

### HTTP Transport

HTTP refuses to start until `CONDUIT_S2S_SECRET` is a real secret (not a known placeholder). Publish the port on loopback.

```bash
# Single-tenant HTTP. Uses ROCKETCYBER_API_KEY after X-Gateway-S2S verifies.
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  ROCKETCYBER_API_KEY=your-api-key \
  MCP_TRANSPORT=http \
  npm start

# Local HTTP only, without a service-to-service secret. Always binds 127.0.0.1.
MCP_TRANSPORT=http MCP_ALLOW_INSECURE_DEV=1 npm start
```

### Docker

The image listens on `0.0.0.0` inside the container (`MCP_HTTP_HOST`) and defaults to `AUTH_MODE=gateway`. Publish the port on loopback and pass a real S2S secret. In gateway mode, RocketCyber credentials arrive on each request as headers; they are not read from the environment.

```bash
docker build -t rocketcyber-mcp --build-arg GITHUB_TOKEN="$GITHUB_TOKEN" .
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -p 127.0.0.1:8080:8080 \
  rocketcyber-mcp
```

Compose refuses to start when `CONDUIT_S2S_SECRET` is unset. The gateway service sets `AUTH_MODE=gateway`, does not inject `ROCKETCYBER_API_KEY`, and publishes `127.0.0.1:8080:8080`:

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" GITHUB_TOKEN="$GITHUB_TOKEN" docker compose up
```

Single-tenant HTTP (`AUTH_MODE=env`) still requires the S2S secret, then uses `ROCKETCYBER_API_KEY`. It is separate from the gateway Compose service above.

```bash
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -e AUTH_MODE=env \
  -e ROCKETCYBER_API_KEY=your-api-key \
  -e ROCKETCYBER_REGION=us \
  -p 127.0.0.1:8080:8080 \
  rocketcyber-mcp
```

## Tools

Every tool below only reads data (no tool issues a write to the RocketCyber API), so each is annotated `annotations: { readOnlyHint: true }` in the `tools/list` response. MCP clients that honor `readOnlyHint` — Microsoft 365 Copilot / Copilot Studio among them — use this to skip the per-call confirmation prompt they'd otherwise show before every tool call.

| Tool | Description | `readOnlyHint` |
|---|---|---|
| `rocketcyber_test_connection` | Test the connection to RocketCyber API | true |
| `rocketcyber_get_account` | Get account information | true |
| `rocketcyber_list_agents` | List monitored agents/endpoints | true |
| `rocketcyber_list_incidents` | List security incidents | true |
| `rocketcyber_list_events` | List security events | true |
| `rocketcyber_get_event_summary` | Get event summary/statistics | true |
| `rocketcyber_list_firewalls` | List firewall devices | true |
| `rocketcyber_list_apps` | List managed apps | true |
| `rocketcyber_get_defender` | Get Windows Defender status | true |
| `rocketcyber_get_office` | Get Office 365 status | true |

## Resources

| URI | Description |
|---|---|
| `rocketcyber://account` | Account information |
| `rocketcyber://incidents` | Security incidents |
| `rocketcyber://agents` | Monitored agents/endpoints |

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Start production server
npm start
```

## License

[Apache-2.0](LICENSE)
