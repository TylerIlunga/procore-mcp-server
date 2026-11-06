# Procore MCP Server

[![procore-mcp-server MCP server](https://glama.ai/mcp/servers/TylerIlunga/procore-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/TylerIlunga/procore-mcp-server)

MCP server that exposes the full [Procore](https://www.procore.com/) REST API to AI assistants like Claude. Built with TypeScript and the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk).

Works with **Claude Desktop**, **Claude Code**, and any MCP-compatible client.

## What it does

A build-time parser converts Procore's OpenAPI spec into a compact catalog, then auto-generates individual MCP tools for every API operation. At runtime, 7 meta-tools let the AI discover and call any Procore endpoint:

| Tool | Purpose |
|------|---------|
| `procore_discover_categories` | List API categories with endpoint counts |
| `procore_discover_endpoints` | List endpoints in a category |
| `procore_search_endpoints` | Full-text search across all endpoints |
| `procore_get_endpoint_details` | Get full parameter schema for an endpoint |
| `procore_api_call` | Execute any Procore API call |
| `procore_get_config` | Show current config and auth status |
| `procore_set_config` | Set runtime config (company_id, project_id) |

## Prerequisites

- Node.js 18+
- A [Procore Developer Portal](https://developers.procore.com/) account
- An OAuth app with **Authorization Code** grant type
- Set your redirect URI to `http://localhost`
- (Alternative, for unattended use) a Developer Managed Service Account app; see
  [Service-account mode](#service-account-client-credentials-mode)

## Setup

```bash
git clone https://github.com/TylerIlunga/procore-mcp-server.git
cd procore-mcp-server
npm install
```

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

```env
PROCORE_CLIENT_ID=your_client_id
PROCORE_CLIENT_SECRET=your_client_secret
PROCORE_COMPANY_ID=your_company_id
```

`PROCORE_ENV` selects the Procore environment:

| Value | Auth host | API host |
|---|---|---|
| `production` (default) | `login.procore.com` | `api.procore.com` |
| `sandbox` | `login-sandbox.procore.com` | `sandbox.procore.com` |
| `sandbox-monthly` | `login-sandbox-monthly.procore.com` | `api-monthly.procore.com` |

**If it is unset the server uses production**, so set it explicitly. The value is
case-insensitive; any other value is rejected at startup rather than silently falling
back to production. The server logs the resolved environment and API host on start.

```env
PROCORE_ENV=sandbox
```

### Service-account (client credentials) mode

To run unattended with a Procore Developer Managed Service Account (DMSA) app instead
of a user login, set:

```env
PROCORE_GRANT_TYPE=client_credentials
```

There is no `npm run auth` step in this mode: the server requests an app-level token at
startup (so bad credentials fail immediately), keeps it in memory only, and requests a
new one when it expires. Nothing is written to `~/.procore-mcp/tokens.json`. The token
acts as the service account, so data visibility is whatever that account has been
granted in the company it is installed in, not any individual user's. The default is
`authorization_code`, unchanged.

By default the server exposes the **7 discovery tools**, and every Procore
endpoint is reached through `procore_api_call`. Registering a dedicated tool
per endpoint instead emits roughly 4.7 MB (~1.2M tokens) of tool definitions —
more than any current model's context window — so that surface is opt-in:

```env
PROCORE_TOOL_MODE=all
```

Coverage is identical in both modes; only the size of the advertised tool list
differs. If you switch to `all` and are migrating from before v2.0.0, see
`data/tool-renames.json` for the old -> new tool name map.

You'll need Procore's OpenAPI spec file placed at `specs/combined_OAS.json`. This file is not included in the repo due to its size (~54MB). You can obtain it from [Procore's API documentation](https://developers.procore.com/).

Build the catalog and compile TypeScript:

```bash
npm run build
```

Authenticate with Procore (opens browser for OAuth):

```bash
npm run auth
```

Start the server:

```bash
npm start
```

## Claude Desktop configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "procore": {
      "command": "node",
      "args": ["/absolute/path/to/procore-mcp-server/dist/src/index.js"],
      "env": {
        "PROCORE_CLIENT_ID": "your_client_id",
        "PROCORE_CLIENT_SECRET": "your_client_secret",
        "PROCORE_COMPANY_ID": "your_company_id"
      }
    }
  }
}
```

## Claude Code configuration

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "procore": {
      "command": "node",
      "args": ["/absolute/path/to/procore-mcp-server/dist/src/index.js"],
      "env": {
        "PROCORE_CLIENT_ID": "your_client_id",
        "PROCORE_CLIENT_SECRET": "your_client_secret",
        "PROCORE_COMPANY_ID": "your_company_id"
      }
    }
  }
}
```

## Project structure

```
src/
  auth/       OAuth token exchange, refresh, storage
  api/        HTTP client with auth, rate limits, retries
  catalog/    Endpoint catalog loading, search, filtering
  tools/      MCP tool handlers and registration
scripts/
  generate-catalog.ts          Parse OAS into catalog
  generate-tools-manifest.ts   Generate per-endpoint MCP tools
  validate-catalog.ts          Validate catalog integrity
data/         Build output (committed): catalog.json, endpoint details, tools manifest
specs/        Source OAS file (gitignored — too large for the repo)
```

## How it works

1. **Build time**: `scripts/generate-catalog.ts` parses the ~54MB Procore OpenAPI spec (3,155 operations) and produces a compact `data/catalog.json` plus individual endpoint detail files in `data/endpoint-details/`. `scripts/generate-tools-manifest.ts` then generates a tools manifest with one named MCP tool per API operation — 2,929 in total, after collapsing older-version duplicates of the same path.

   Each generated tool carries a structured description covering what it acts on, when to reach for it, which parent ids to resolve first, what it returns, and how it fails. Endpoints Procore has deprecated are registered with their sunset date in the description and a `(Deprecated)` title. The interactive `/oauth/*` endpoints are not registered as tools — `npm run auth` owns that flow — but remain reachable through `procore_api_call`.

2. **Auth**: Run `npm run auth` once to complete the OAuth flow in your browser. Tokens are saved to `~/.procore-mcp/tokens.json` and auto-refresh when expired.

3. **Runtime**: The MCP server loads the catalog and registers the 7 discovery tools (plus the full per-endpoint surface when `PROCORE_TOOL_MODE=all`). When an AI assistant calls a tool, the server maps it to the correct Procore API endpoint, injects auth headers, handles rate limits and pagination, and returns the response.

## Inspiration

Built to help my girlfriend, a construction engineer who uses Procore daily.

## License

MIT
