# Procore MCP Server

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
- Set your redirect URI to `http://localhost:9876/callback`

## Setup

```bash
git clone https://github.com/beaubits/procore-mcp-server.git
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

You'll need Procore's OpenAPI spec file placed at `specs/combined_OAS.json`. This file is not included in the repo due to its size (~41MB). You can obtain it from [Procore's API documentation](https://developers.procore.com/).

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
data/         Build output (gitignored): catalog.json, endpoint details
specs/        Source OAS file (gitignored)
```

## How it works

1. **Build time**: `scripts/generate-catalog.ts` parses the 41MB Procore OpenAPI spec and produces a compact `data/catalog.json` plus individual endpoint detail files in `data/endpoint-details/`. `scripts/generate-tools-manifest.ts` then generates a tools manifest with one named MCP tool per API operation.

2. **Auth**: Run `npm run auth` once to complete the OAuth flow in your browser. Tokens are saved to `~/.procore-mcp/tokens.json` and auto-refresh when expired.

3. **Runtime**: The MCP server loads the catalog and registers all tools. When an AI assistant calls a tool, the server maps it to the correct Procore API endpoint, injects auth headers, handles rate limits and pagination, and returns the response.

## License

MIT
