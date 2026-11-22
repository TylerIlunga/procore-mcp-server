# AGENTS.md

Entry point for coding agents (Codex, Cursor, and others). Claude Code reads
[CLAUDE.md](./CLAUDE.md), which is the canonical source for build pipeline,
tool-description rules, and release steps. This file is a map, not a copy.

## Project

**Procore MCP Server**: an MCP server (stdio transport) that exposes the full
Procore REST API to MCP clients such as Claude Desktop and Claude Code.
TypeScript (strict, ES2022, Node16 modules), `@modelcontextprotocol/sdk`, `zod`.
Single-user OAuth against Procore.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Regenerate the catalog from `specs/combined_OAS.json`, validate it, compile |
| `npx tsc --noEmit` | Type check |
| `npm run validate` | Validate committed catalog artifacts in `data/` |
| `npm test` | Verify tool-manifest invariants (`scripts/verify-manifest.ts`) |
| `./scripts/arch-lint.sh` | Enforce the `src/` module dependency direction |
| `./scripts/quality-scan.sh` | 300-line limit in `src/`, no stdout writes in server code, secrets |
| `./scripts/doc-check.sh` | Required docs present, no template placeholders, no broken links |

All of these run in CI (`.github/workflows/verify.yml`, `ci.yml`). The OAS
spec is gitignored, so CI checks the committed `data/` artifacts and never
regenerates them.

## Rules that bite

1. **Never write to stdout in server code.** stdout carries the JSON-RPC
   protocol, so use `console.error` for diagnostics. The only exception is
   `src/auth/setup.ts`, the interactive `npm run auth` CLI.
2. **Tool descriptions must not overclaim.** See "Tool Description Quality" in
   CLAUDE.md. `npm test` enforces it.
3. **300 lines per file in `src/`.** Extract a focused module instead of growing one.
4. **Respect the module direction** described in [ARCHITECTURE.md](./ARCHITECTURE.md).
5. **Never commit secrets.** `.env`, `.mcp.json`, and `~/.procore-mcp/tokens.json`
   stay out of the repo, and `client_credentials` tokens never touch disk. See [docs/SECURITY.md](./docs/SECURITY.md).
6. **Bump `package.json` in the release PR.** It is not automatic.

## Docs map

| Document | Purpose |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | Build pipeline, description rules, naming, releasing |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Modules, data flow, dependency rules |
| [docs/PRODUCT.md](./docs/PRODUCT.md) | Who uses this and how; glossary |
| [docs/QUALITY.md](./docs/QUALITY.md) | Quality gates and known gaps |
| [docs/RELIABILITY.md](./docs/RELIABILITY.md) | Retries, rate limits, token refresh, error surfacing |
| [docs/SECURITY.md](./docs/SECURITY.md) | Credentials, token storage, PR checklist |
