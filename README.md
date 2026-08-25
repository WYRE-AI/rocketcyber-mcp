# rocketcyber-mcp

MCP (Model Context Protocol) server for the [RocketCyber](https://www.rocketcyber.com/) Managed SOC platform. Provides read-only access to RocketCyber security data through 10 tools and 3 resources.

## Features

- 10 read-only tools covering all RocketCyber API resources
- 3 MCP resources for quick data access
- Dual transport: stdio (default) and HTTP Streamable
- Lazy SDK initialization on first tool call
- Winston logger with all output routed to stderr
- Connection test tool for validating credentials

## One-Click Deployment

> [!IMPORTANT]
> **Before you click:** this server depends on `@wyre-technology/node-rocketcyber`,
> which is hosted on the **GitHub Packages** npm registry. GitHub Packages has no
> anonymous access — even though the package is public, every `npm install` needs a
> token. The cloud builder runs `npm install` for you, so you must give it one, or
> the build fails with `npm error 401 Unauthorized ... npm.pkg.github.com`.
>
> 1. Create a GitHub **Personal Access Token** with the `read:packages` scope
>    ([classic token](https://github.com/settings/tokens/new?scopes=read:packages&description=rocketcyber-mcp%20deploy)).
>    Any GitHub account works — you do **not** need to be a member of the
>    `wyre-technology` org to read its public packages.
> 2. Add it as a build variable when prompted by the deploy flow:
>    - **Cloudflare Workers** → set a build variable named **`NODE_AUTH_TOKEN`** to your PAT
>      (Workers → Settings → Build → Variables and Secrets).
>    - **DigitalOcean App Platform** → set an encrypted env var named **`GITHUB_TOKEN`**
>      with scope **Build Time** to your PAT (the Dockerfile reads it for the install).

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/WYRE-AI/rocketcyber-mcp/tree/main)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/WYRE-AI/rocketcyber-mcp)

## Installation

This project depends on `@wyre-technology/node-rocketcyber`, published to the
**GitHub Packages** npm registry, which requires a token even for public packages.
Authenticate once, then install:

```bash
# Authenticate npm to GitHub Packages (token needs the read:packages scope)
export NODE_AUTH_TOKEN=$(gh auth token)   # or a PAT with read:packages

npm install
npm run build
```

The repo's `.npmrc` already points the `@wyre-technology` scope at GitHub Packages and
reads the token from `NODE_AUTH_TOKEN`, so no further config is needed.

## Configuration

| Environment Variable | Required | Default | Description |
|---|---|---|---|
| `ROCKETCYBER_API_KEY` | Yes | - | RocketCyber API key |
| `ROCKETCYBER_REGION` | No | `us` | API region: `us` or `eu` |
| `MCP_TRANSPORT` | No | `stdio` | Transport type: `stdio` or `http` |
| `MCP_HTTP_PORT` | No | `8080` | HTTP port (when using http transport) |
| `MCP_HTTP_HOST` | No | `0.0.0.0` | HTTP host (when using http transport) |
| `LOG_LEVEL` | No | `info` | Log level: `error`, `warn`, `info`, `debug` |
| `LOG_FORMAT` | No | `simple` | Log format: `json` or `simple` |

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

```bash
ROCKETCYBER_API_KEY=your-api-key MCP_TRANSPORT=http npm start
```

## Tools

| Tool | Description |
|---|---|
| `rocketcyber_test_connection` | Test the connection to RocketCyber API |
| `rocketcyber_get_account` | Get account information |
| `rocketcyber_list_agents` | List monitored agents/endpoints |
| `rocketcyber_list_incidents` | List security incidents |
| `rocketcyber_list_events` | List security events |
| `rocketcyber_get_event_summary` | Get event summary/statistics |
| `rocketcyber_list_firewalls` | List firewall devices |
| `rocketcyber_list_apps` | List managed apps |
| `rocketcyber_get_defender` | Get Windows Defender status |
| `rocketcyber_get_office` | Get Office 365 status |

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
