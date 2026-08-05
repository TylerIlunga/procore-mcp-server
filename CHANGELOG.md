# Changelog

All notable changes to this project are documented here.

From v1.3.0 onward this file is maintained automatically by
[release-please](https://github.com/googleapis/release-please) from Conventional
Commit messages. Entries below v1.3.0 were written by hand and are preserved for
history.

## [1.2.0](https://github.com/TylerIlunga/procore-mcp-server/releases/tag/v1.2.0) (2026-08-05)

### Features

- Refresh to the 2026-08-04 Procore API spec: 2,636 → 3,155 catalog operations,
  2,489 → 2,936 registered tools ([#2](https://github.com/TylerIlunga/procore-mcp-server/pull/2))
- Register the new Assets, Materials Management, Estimating, Document Management
  and Document Markup modules
- Flag 166 deprecated endpoints in-description with their sunset date and a
  `(Deprecated)` title

### Bug Fixes

- Remove 26 tools whose endpoints no longer exist and returned 404 against live
  Procore — the Payments sub-surface, `app_installations` writes, and
  `equipment_register` project writes
- Name the real resource in descriptions instead of the OAS category, fixing
  ~1,144 tools that read e.g. "a specific Field Productivity records"
- Derive pagination from the OAS response schema, correcting 165 singleton GETs
  that advertised a paginated array; the same flag now gates `page`/`per_page`
  in the input schema
- Dedupe 33 tools that declared the same key twice (path + body), where the body
  field silently overwrote the path parameter in the generated schema
- Stop discarding a disambiguating tool-name suffix during truncation, which
  could reintroduce a name collision
- Mark PATCH idempotent

### Refactoring

- Split `description-builder.ts` into `resource-label.ts`, `behavior-builder.ts`
  and `param-descriptions.ts` to stay under the 300-line file limit

## [1.1.0](https://github.com/TylerIlunga/procore-mcp-server/releases/tag/v1.1.0) (2026-05-08)

### Bug Fixes

- Open the browser cross-platform on Windows and Linux during `npm run auth`,
  fixing a silent 5-minute timeout for every non-macOS user
  ([#1](https://github.com/TylerIlunga/procore-mcp-server/pull/1)) — thanks
  [@aprotteau-dac](https://github.com/aprotteau-dac)
- Register all tools through the SDK's `registerTool()` API with titles and
  annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`)
- Drop 154 deprecated older-version duplicate tools by grouping endpoints on
  method + version-normalized path and keeping only the highest version
  (2,636 → 2,482 tools)

## [1.0.0](https://github.com/TylerIlunga/procore-mcp-server/releases/tag/v1.0.0) (2026-04-13)

Initial release. MCP server exposing the full Procore REST API (2,636 endpoints)
for Claude Desktop, Claude Code, and MCP-compatible clients.

### Features

- 7 meta-tools for endpoint discovery and API execution
- Build-time OpenAPI spec parser generating a compact catalog
- Single-user OAuth with automatic token refresh
- Rate limiting, retries, and pagination handling
