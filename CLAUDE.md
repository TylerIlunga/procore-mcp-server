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
| `src/tools/purpose-builder.ts` | Verb-aware purpose synthesis (a reorder is never described as a create) |
| `src/tools/description-builder.ts` | Deprecation notice, usage guidance, prerequisites, assembly |
| `src/tools/behavior-builder.ts` | Return shape, side effects, failure modes |
| `src/tools/param-descriptions.ts` | Per-parameter prose and source hints |
| `src/tools/annotation-builder.ts` | Titles and MCP annotations |
| `src/tools/version-sibling-note.ts` | Names cross-version sibling tools in the description |

Pagination is advertised only when the endpoint genuinely returns a collection
(`returnsCollection`), in both the description and the input schema.
`schemaIsCollection` in `scripts/generate-catalog.ts` unwraps `{ data: [...] }`
envelopes (and any single-property object wrapping an array, whatever it's
named — Procore's v1.0 endpoints often envelope under the plural resource
name, e.g. `{ exchange_rates: [...] }`) and merges `allOf` branches into one
schema before judging it, rather than treating `allOf` like `oneOf` (an
optional array-typed field on one branch doesn't make the *merged* object a
list). When the schema itself asserts a single object, that verdict only
flips on strong corroboration: a non-`{id}` path trusts either declared
pagination or explicit list language in the summary/description; an
`{id}`-shaped path requires *both*, since Procore sometimes declares
`page`/`per_page` on a genuine show-by-id endpoint with no textual list
signal behind it. A scalar/binary response (`type: "string", format:
"binary"` — a raw CSV/PDF file download) is never a collection regardless of
declared pagination, since a file body can't be "a JSON array of records".
The envelope key is recorded as `collectionEnvelope` and named in the
behavior sentence.

Procore's own OAS text is untrustworthy in two specific, narrow cases, both
handled in `generate-tools-manifest.ts` by clearing the inherited
`description` so the tool falls back to its own summary-driven synthesis:
a GET whose description opens with "Creates"/"Create" (a genuine spec error,
unlike a PATCH/PUT upsert legitimately described that way), and a
sub-resource action that shares byte-identical description text with its
base resource's endpoint (`signature_requests` vs
`signature_requests/{id}/signature`) — detected by one path's real segments
being a strict prefix of the other's, as opposed to a scope variant that
inserts a segment in the middle and legitimately shares one description.

Three rules keep the prose honest, all enforced by `npm test`
(`scripts/verify-manifest.ts`, which also runs in CI):

- **Never claim semantics the name does not carry.** A POST named `reorder_*`
  is not a create, a DELETE named `recycle_*` is a soft delete, and a
  `bulk_*`/`sync_*` call is described in the plural.
- **Name the right record.** The id closing a path is the *target*, not a
  "parent record"; non-identifier path params (`{new_status}`) are neither.
  A multipart/form-data PATCH/PUT (a file upload) doesn't get the "send only
  the fields you intend to change" partial-update clause — the whole file is
  what's being replaced, not a selection of JSON fields.
- **Disambiguate cross-version siblings.** When Procore exposes the same
  operation at two API versions under different paths (dedup can't merge
  them — e.g. v1.1 moved weather logs under `daily_logs/`), each tool's
  description names its sibling(s) rather than reading identically. Grouping
  is by normalized summary text, guarded so a generic summary reused across
  unrelated resources ("Create Attachment" on witness statements, checklist
  lists, incidents, ...) doesn't get treated as one family, and so a
  `bulk_*`/`batch_*` endpoint never gets paired with the single-record
  version of the same summary.

Name collisions are broken with meaning-bearing suffixes (scope, version,
distinguishing path segment, HTTP method) before falling back to numbers.
Renaming one member of a family can create a *new* collision with an
unrelated entry (a scope suffix landing on a name a sibling's own summary
already produced) — `resolveCollisions` reruns the whole stage sequence
until a pass makes no changes, rather than handing that new collision
straight to the numeric fallback. A scopeless member of a scope-spanning
family (no `company_id`/`project_id` in its path at all) gets an explicit
`_unscoped` suffix instead of being silently skipped. Versioning groups
strip filler articles ("Create Coordination Issue" / "Create a coordination
issue") so real siblings aren't missed over a stray "a". A bare HTTP-method
word leading an OAS summary ("POST Company Role") is normalized to its
natural verb before any of this runs, since it produces names like
`post_company_role` otherwise.

Generated tool names follow a `verb_noun` convention imposed by
`scripts/normalize-verbs.ts`, which runs between naming and collision
resolution. Procore's own titles reach for whatever verb the doc author liked
("List RFIs", "Show RFI", "Get All Equipment", "Retrieve Note"), so the read
synonyms all collapse to `list_` or `get_` — chosen from
`returnsCollection`, not from the prose, so the name is correct by
construction and stays consistent with the description. Third-person titles
("Creates"/"Updates") fold to the imperative, and `destroy_` on a DELETE
folds to `delete_`. Verbs naming a *distinct* action — reorder, recycle,
restore, sync, send, close, assign, and add/remove in their association sense
— are deliberately left alone, since flattening them onto a CRUD prefix would
reintroduce exactly the name-vs-semantics bug the rest of this section exists
to prevent. `data/tool-renames.json` records old -> current names for anyone
migrating.

Two truncation limits on the same raw OAS description text (in
`generate-catalog.ts` and `generate-tools-manifest.ts`) must stay in sync —
a lower second limit silently re-truncates text the first limit already
let through, severing markdown tables (Procore's file-format lists, mainly)
mid-row again. Separately, the rollback in `trimToWholeSentence` that walks
a truncated description back to its last full sentence must not treat an
abbreviation's period ("e.g.", "i.e.") as a sentence end, or it truncates
one clause into the next.

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

With `PROCORE_GRANT_TYPE=client_credentials` there is no step 1: the server mints
an app-level token at startup and re-mints it on expiry or a 401.

### Environment Variables

```
PROCORE_CLIENT_ID     - OAuth client ID from Procore Developer Portal
PROCORE_CLIENT_SECRET - OAuth client secret
PROCORE_COMPANY_ID    - Default Procore company ID (integer)
PROCORE_ENV           - "production" (default when unset), "sandbox", or
                        "sandbox-monthly". Any other value is rejected at startup.
PROCORE_GRANT_TYPE    - "authorization_code" (default; `npm run auth` once) or
                        "client_credentials" (service-account/DMSA app; token
                        minted at startup, held in memory, never on disk).
PROCORE_TOKEN_PATH    - Optional token file path (default ~/.procore-mcp/tokens.json)
PROCORE_TOOL_MODE     - "meta" (default) serves only the 7 discovery tools;
                        "all" additionally registers one tool per endpoint.
                        Coverage is identical either way — procore_api_call
                        reaches every endpoint in both modes.
```

## Releasing

Releases are cut by hand. **Bump `package.json` in the same PR as the release** —
it is not updated automatically, and silently drifted from the tags between
v1.0.0 and v1.2.0.

1. Merge the work to `main`.
2. Set `version` in `package.json` to the version being shipped.
3. Tag and publish:
   `gh release create vX.Y.Z --target main --title "..." --notes-file NOTES.md`

Notes: `--target` takes a branch name or a full commit SHA — an abbreviated SHA
is rejected. Write notes to a file rather than inlining them; long `--notes`
heredocs are easy to mangle.

## Coding Conventions

- TypeScript strict mode, ES2022 target, Node16 modules
- Node built-in fetch (no axios)
- File size limit: 300 lines per file
- All env vars validated at startup
