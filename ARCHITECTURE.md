# Architecture

## System overview

```
                build time                                  run time
specs/combined_OAS.json                         MCP client (Claude Desktop / Code)
        |                                                |  stdio JSON-RPC
scripts/generate-catalog.ts                       src/index.ts
        |                                                |
data/catalog.json, categories.json,         src/tools/  (handlers, registry,
data/endpoint-details/*.json                            auto-register, description builders)
        |                                          |              |
scripts/generate-tools-manifest.ts           src/catalog/      src/api/client.ts
        |                                   (reads data/)          |
data/tools-manifest.json  ------------------------^           src/auth/ (OAuth, tokens)
                                                                   |
                                                         Procore REST API
```

**Build time:** Procore's OpenAPI spec (gitignored, about 64MB) is compiled into
committed JSON artifacts under `data/`. The server never parses the spec at
run time.

**Run time:** `src/index.ts` loads `.env` (it never overrides variables that are
already set), validates `PROCORE_CLIENT_ID`/`PROCORE_CLIENT_SECRET`,
`PROCORE_ENV` and `PROCORE_GRANT_TYPE`, then checks auth. With `authorization_code`
that means a token file must exist; with `client_credentials` it mints a token. It then
registers the tools over stdio:

- `PROCORE_TOOL_MODE=meta` (the default) registers the 7 discovery tools. `procore_api_call`
  reaches every endpoint.
- `PROCORE_TOOL_MODE=all` additionally registers one tool per endpoint from
  `data/tools-manifest.json` (`src/tools/auto-register.ts`).

## Modules

| Module | Responsibility | May import from |
|---|---|---|
| `src/auth/` | Environment and grant selection; OAuth code exchange and refresh (refresh-token rotation); in-memory `client_credentials` tokens; token file I/O; `npm run auth` CLI | nothing in `src/` |
| `src/catalog/` | Load and search the generated catalog in `data/` | nothing in `src/` |
| `src/api/` | Authenticated HTTP client: pagination, rate limits, retries | `auth` |
| `src/tools/` | MCP tool handlers, registry, generated-description builders | `auth`, `api`, `catalog` |
| `src/index.ts` | Process entry point and wiring | anything |
| `scripts/` | Build-time generation and verification | never imported by `src/` |

`./scripts/arch-lint.sh` enforces this table in CI.

## Key decisions

| Decision | Rationale |
|---|---|
| Generate the catalog at build time and commit `data/` | No 64MB parse at startup; CI can verify artifacts without the spec |
| Meta tools by default, per-endpoint tools opt-in | Around 2,900 tools overwhelm tool selection; coverage is identical either way |
| Node built-in `fetch`, no HTTP library | Fewer dependencies; Node 20+ ships it |
| Tool names normalized to `verb_noun` | Procore's titles use inconsistent verbs; see CLAUDE.md |

## Infrastructure

- **Distribution:** run locally from a clone as an MCP stdio server. There is no hosted deployment.
- **CI:** GitHub Actions. `verify.yml` runs typecheck, catalog validation, and manifest
  invariants. `ci.yml` runs the repo-convention checks. `doc-gardening.yml` runs a weekly
  docs freshness report.
- **Releases:** cut by hand with `gh release create`; see CLAUDE.md.
