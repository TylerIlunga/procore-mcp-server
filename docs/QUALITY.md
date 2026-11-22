# Quality

## Gates (all run in CI)

| Gate | Command | Catches |
|---|---|---|
| Type check | `npx tsc --noEmit` | Type errors |
| Catalog validation | `npm run validate` | Malformed or inconsistent `data/` artifacts |
| Manifest invariants | `npm test` | Description overclaims, wrong verbs, name collisions, pagination mismatches |
| Meta-tool names | `npm test` | A meta tool not named `procore_<verb>_<noun>`, a retired name (`procore_api_call`) listed in tools/list, or an alias that no longer routes |
| Architecture | `./scripts/arch-lint.sh` | `src/` imports against the module direction |
| Conventions | `./scripts/quality-scan.sh` | Files over 300 lines in `src/`, stdout writes in server code, secrets |
| Docs | `./scripts/doc-check.sh` | Missing docs, template placeholders, broken links |

External signal: Glama scores tool definitions (TDQS, currently A) and repo
maintenance (commit activity over 12 weeks, releases, issue response).

## Known gaps

| Area | Gap | Priority |
|---|---|---|
| Reliability | No per-request timeout on Procore calls (`fetch` without `AbortSignal`), so a hung connection blocks the tool call | Medium |
| Tests | Behavior is verified through manifest invariants only; no unit tests for `src/api/client.ts` retry and refresh paths | Medium |
| File size | `scripts/generate-catalog.ts` (637), `scripts/generate-tools-manifest.ts` (653), `scripts/manifest-helpers.ts` (308) exceed the 300-line limit. Build-time only, so outside the `src/` gate | Low |
