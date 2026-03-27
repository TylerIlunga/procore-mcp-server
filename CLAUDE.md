# Procore MCP Server

> MCP server exposing the full Procore REST API (1,743 endpoints) for Claude Desktop and Claude Code. Single-user OAuth. TypeScript + @modelcontextprotocol/sdk.

## Quick Start

```bash
npm install
npm run build          # Generate catalog from OAS + compile TypeScript
npm run auth           # One-time: OAuth flow to get Procore tokens
npm start              # Start MCP server (stdio transport)
```

## Architecture

**7 MCP tools** provide full coverage of 1,743 Procore API endpoints:

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

`specs/combined_OAS.json` (41MB) → `scripts/generate-catalog.ts` → `data/catalog.json` + `data/endpoint-details/`

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

1. Run `npm run auth` → opens browser → Procore OAuth → tokens saved to `~/.procore-mcp/tokens.json`
2. MCP server reads tokens on startup, auto-refreshes when expired

### Environment Variables

```
PROCORE_CLIENT_ID     — OAuth client ID from Procore Developer Portal
PROCORE_CLIENT_SECRET — OAuth client secret
PROCORE_COMPANY_ID    — Default Procore company ID (integer)
```

## Coding Conventions

- TypeScript strict mode, ES2022 target, Node16 modules
- Node built-in fetch (no axios)
- File size limit: 300 lines per file
- All env vars validated at startup
