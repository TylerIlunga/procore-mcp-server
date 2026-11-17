# Quality

## Gates (all run in CI)

| Gate | Command | Catches |
|---|---|---|
| Type check | `npx tsc --noEmit` | Type errors |
| Catalog validation | `npm run validate` | Malformed or inconsistent `data/` artifacts |
| Manifest invariants | `npm test` | Description overclaims, wrong verbs, name collisions, pagination mismatches |
| Architecture | `./scripts/arch-lint.sh` | `src/` imports against the module direction |
| Conventions | `./scripts/quality-scan.sh` | Files over 300 lines in `src/`, stdout writes in server code, secrets |
| Docs | `./scripts/doc-check.sh` | Missing docs, template placeholders, broken links |

External signal: Glama scores tool definitions (TDQS, currently A) and repo
maintenance (commit activity over 12 weeks, releases, issue response).

## Known gaps

| Area | Gap | Priority |
|---|---|---|
| Spec freshness | `specs/combined_OAS.json` is from 2026-08-04. Procore's changelogs since then add 16 endpoints and deprecate others (budget-view rows, `selected_uploads`/`selected_revisions` v2.0/2.1, `meetings/ecrion_pdf_generation_data`). Regenerate from a fresh spec | High |
| Reliability | No per-request timeout on Procore calls (`fetch` without `AbortSignal`), so a hung connection blocks the tool call | Medium |
| Tests | Behavior is verified through manifest invariants only; no unit tests for `src/api/client.ts` retry and refresh paths | Medium |
| File size | `scripts/generate-catalog.ts` (637), `scripts/generate-tools-manifest.ts` (653), `scripts/manifest-helpers.ts` (308) exceed the 300-line limit. Build-time only, so outside the `src/` gate | Low |
| Naming | `procore_api_call` breaks the `verb_noun` pattern (TDQS naming 4/5) | Low |
