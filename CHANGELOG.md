## [Unreleased]

### Fixed

- **The HTTP transport no longer exits on a malformed request (WYREAI-741).** The request
  target was parsed against the client-supplied `Host` header, and a value that does not parse
  (or a target such as `//`) threw inside the request listener before authentication. The
  target is now parsed against a fixed base, so `Host` is no longer consulted, and a target
  that still cannot be parsed gets a `400` JSON response while the server keeps running.

- One-click cloud deploys (Cloudflare Workers, DigitalOcean) no longer fail with
  `npm error 401 Unauthorized` from `npm.pkg.github.com`. The `.npmrc` now carries the
  GitHub Packages auth-token line (`${NODE_AUTH_TOKEN}`) and the Dockerfile writes a
  temporary authenticated `.npmrc` from the `GITHUB_TOKEN` build arg before `npm ci`,
  so operators can supply their own `read:packages` PAT as a build variable.

### Changed

- README documents creating a `read:packages` PAT and setting `NODE_AUTH_TOKEN`
  (Cloudflare) / build-time `GITHUB_TOKEN` (DigitalOcean) before deploying or installing.
- **npm package:** the package is now scoped to `@wyre-technology/rocketcyber-mcp` and is
  published to the **GitHub Packages** npm registry (`https://npm.pkg.github.com`) on each
  release. The previous unscoped name (`rocketcyber-mcp`) was never published. The
  `rocketcyber-mcp` CLI/bin command name is unchanged.

## [1.1.7](https://github.com/wyre-technology/rocketcyber-mcp/compare/v1.1.6...v1.1.7) (2026-02-26)


### Bug Fixes

* **ci:** remove unused discord-release.yml ([3eb3eb3](https://github.com/wyre-technology/rocketcyber-mcp/commit/3eb3eb34505546f86e1bc7e24db88b13ecde7acc))

## [1.1.6](https://github.com/wyre-technology/rocketcyber-mcp/compare/v1.1.5...v1.1.6) (2026-02-24)


### Bug Fixes

* **deps:** update node-rocketcyber SDK to fix response body double-read ([51d31b8](https://github.com/wyre-technology/rocketcyber-mcp/commit/51d31b84a50d2e03ff7b2e74911729f433b05f34))

## [1.1.5](https://github.com/wyre-technology/rocketcyber-mcp/compare/v1.1.4...v1.1.5) (2026-02-24)


### Bug Fixes

* use per-request Server+Transport for stateless HTTP mode ([03e1b35](https://github.com/wyre-technology/rocketcyber-mcp/commit/03e1b352fdb2342fb6ffc95e2d6b33bf7a1d0ea9))

## [1.1.4](https://github.com/wyre-technology/rocketcyber-mcp/compare/v1.1.3...v1.1.4) (2026-02-24)


### Bug Fixes

* use stateless HTTP transport for multi-client gateway support ([46ecd27](https://github.com/wyre-technology/rocketcyber-mcp/commit/46ecd271545fd577af56f2699eca799af8902d5e))

## [1.1.3](https://github.com/wyre-technology/rocketcyber-mcp/compare/v1.1.2...v1.1.3) (2026-02-24)


### Bug Fixes

* **docker:** prune dev deps in builder stage to preserve GitHub Packages deps ([f6b15f8](https://github.com/wyre-technology/rocketcyber-mcp/commit/f6b15f814ddf20169e82255d77f4f312fa1755f0))

## [1.1.2](https://github.com/wyre-technology/rocketcyber-mcp/compare/v1.1.1...v1.1.2) (2026-02-24)


### Performance Improvements

* **docker:** remove npm upgrade to speed up multi-platform builds ([7b83e69](https://github.com/wyre-technology/rocketcyber-mcp/commit/7b83e69f67eb071f8888fc65512aa3a1fba6a967))

## [1.1.1](https://github.com/wyre-technology/rocketcyber-mcp/compare/v1.1.0...v1.1.1) (2026-02-24)


### Bug Fixes

* **ci:** add Setup Node step to Docker job for version extraction ([18666e2](https://github.com/wyre-technology/rocketcyber-mcp/commit/18666e2afb2ac3a692e0f95e9f3eaaea5d6ec0ea))

# [1.1.0](https://github.com/wyre-technology/rocketcyber-mcp/compare/v1.0.0...v1.1.0) (2026-02-24)


### Features

* add gateway auth mode and Dockerfile for hosted deployment ([0f57851](https://github.com/wyre-technology/rocketcyber-mcp/commit/0f578518224fea7caf290de56ced39657e93eb43))

# 1.0.0 (2026-02-24)


### Bug Fixes

* add .gitignore and remove node_modules/dist from tracking ([e3d52be](https://github.com/wyre-technology/rocketcyber-mcp/commit/e3d52be9788cd6d10a8bd5977d5477d50772af4f))
* add semantic-release branch configuration ([d7912f4](https://github.com/wyre-technology/rocketcyber-mcp/commit/d7912f48796dce8ca7f5db5e4d6cf770075c5ebe))


### Features

* initial rocketcyber-mcp server with 10 read-only tools ([59b4968](https://github.com/wyre-technology/rocketcyber-mcp/commit/59b49682c2d2085f2e78ed6f9153ade572960171))
* pass through region config to SDK ([15d96e7](https://github.com/wyre-technology/rocketcyber-mcp/commit/15d96e719103d8e700632314637d9b8b62ce3fbc))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Gateway authentication mode (`AUTH_MODE=gateway`) for hosted deployment behind the MCP Gateway
- Per-request credential extraction from `X-RocketCyber-API-Key` and `X-RocketCyber-Region` HTTP headers
- `parseCredentialsFromHeaders()` utility for header-based credential parsing
- `updateCredentials()` method on `RocketCyberService` for runtime credential swapping
- Dockerfile with multi-stage build (node:22-alpine) for containerized deployment
- Docker job in CI workflow to build and push to GHCR (`ghcr.io/wyre-technology/rocketcyber-mcp`)
- Health check endpoint now reports `authMode` in gateway mode

## [1.0.0] - 2026-02-23

### Added

- Initial release of RocketCyber MCP server
- 10 read-only tools covering Account, Agents, Incidents, Events, Firewalls, Apps, Defender, and Office 365
- MCP resources for account, incidents, and agents
- Dual transport support: stdio (default) and HTTP Streamable
- Lazy SDK initialization on first tool call
- Winston logger with all output to stderr
- Connection test tool
