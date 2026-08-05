# Procore MCP Server

> MCP server exposing the full Procore REST API for Claude Desktop and Claude Code. Single-user OAuth. TypeScript + @modelcontextprotocol/sdk.

## Quick Start

```bash
npm install
npm run build          # Generate catalog from OAS + compile TypeScript
npm run auth           # One-time: OAuth flow to get Procore tokens
npm start              # Start MCP server (stdio transport)
```

## Architecture

**7 MCP tools** provide full coverage of Procore API endpoints:

| Tool | Purpose |
|------|---------|
| `procore_discover_categories` | List API categories with endpoint counts |
| `procore_discover_endpoints` | List endpoints in a category/module |
| `procore_get_endpoint_details` | Get full parameter schema for an endpoint |
| `procore_api_call` | Execute any Procore API call |
| `procore_search_endpoints` | Full-text search across endpoints |
| `procore_get_config` | Show current config (company_id, auth status) |
| `procore_set_config` | Set runtime config (company_id, project_id) |

### Build Pipeline

`specs/combined_OAS.json` (~54MB) -> `scripts/generate-catalog.ts` -> `data/catalog.json` + `data/endpoint-details/` -> `scripts/generate-tools-manifest.ts` -> `data/tools-manifest.json`

Current spec (2026-08-04): 3,155 operations -> 2,929 generated tools + 7 meta tools.
The manifest drops older-version duplicates of the same path and the
non-callable `/oauth/*` endpoints; both stay reachable via `procore_api_call`.

### Tool Description Quality

Generated tool descriptions are assembled from one sentence per scoring
dimension, and no sentence may restate another:

| Module | Responsibility |
|--------|----------------|
| `src/tools/resource-label.ts` | Names the actual resource from the OAS summary (never the category) |
| `src/tools/description-builder.ts` | Purpose, deprecation notice, usage guidance, assembly |
| `src/tools/behavior-builder.ts` | Return shape, side effects, failure modes |
| `src/tools/param-descriptions.ts` | Per-parameter prose and source hints |
| `src/tools/annotation-builder.ts` | Titles and MCP annotations |

Pagination is advertised only when the OAS response schema is genuinely an
array (`returnsCollection`), in both the description and the input schema.

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/auth/` | OAuth token exchange, refresh, storage |
| `src/api/` | HTTP client with auth, rate limits, retries |
| `src/catalog/` | Endpoint catalog loading, search, filtering |
| `src/tools/` | MCP tool handlers and registration |
| `scripts/` | Build-time catalog generation and validation |
| `data/` | Build output: catalog.json, endpoint details |
| `specs/` | Source OAS file (gitignored) |

### Auth Flow

1. Run `npm run auth` -> opens browser -> Procore OAuth -> tokens saved to `~/.procore-mcp/tokens.json`
2. MCP server reads tokens on startup, auto-refreshes when expired

### Environment Variables

```
PROCORE_CLIENT_ID     - OAuth client ID from Procore Developer Portal
PROCORE_CLIENT_SECRET - OAuth client secret
PROCORE_COMPANY_ID    - Default Procore company ID (integer)
```

## Releasing

Releases are automated by [release-please](https://github.com/googleapis/release-please)
(`.github/workflows/release-please.yml`). Do not tag or publish releases by hand.

1. Land work on `main` with a Conventional Commit subject — `feat:` bumps the
   minor version, `fix:` the patch, and `feat!:`/`BREAKING CHANGE:` the major.
   `docs:` and `chore:` are recorded but never bump.
2. release-please keeps a single open `chore(release): x.y.z` PR on `main` that
   accumulates every merge since the last release.
3. Merging that release PR tags the version, publishes the GitHub Release,
   bumps `package.json`, and updates `CHANGELOG.md`.

`.release-please-manifest.json` holds the current version and must stay in sync
with `package.json`; release-please updates both.

## Coding Conventions

- TypeScript strict mode, ES2022 target, Node16 modules
- Node built-in fetch (no axios)
- File size limit: 300 lines per file
- All env vars validated at startup
