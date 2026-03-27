# AGENTS.md

This file is for OpenAI Codex and other coding agents.
For Claude Code, see [CLAUDE.md](./CLAUDE.md) (identical principles apply).

## Project Overview

<!-- Replace with your project description -->
**Name:** [PROJECT_NAME]
**Type:** [web app | API | CLI | library | mobile app]
**Stack:** [e.g., Next.js, TypeScript, Tailwind, Supabase]

## Core Principles

1. **Repository is the system of record.** If it's not in the repo, it doesn't exist for agents.
2. **Read before writing.** Always read existing code and docs before making changes.
3. **Follow existing patterns.** If a pattern exists in the codebase, replicate it.
4. **Validate at boundaries.** Parse and validate all external data at system edges.
5. **Write tests.** Every new behavior needs a test. Every bug fix needs a regression test.
6. **Keep files small.** Max 300 lines per file. Split into focused modules.
7. **Structured logging only.** No console.log in production code.
8. **Update docs.** If your change affects architecture or conventions, update the relevant doc.

## Architecture Summary

Domains follow a strict layered model. Dependencies flow in one direction only:

```
Types -> Config -> Repository -> Service -> Runtime -> UI
```

- Layers may only import from layers above them
- Cross-domain imports go through the Service layer only
- No circular dependencies between domains
- Shared utilities live in `src/lib/`
- Cross-cutting concerns (auth, telemetry, flags) go through Providers

## Directory Structure

```
src/
  lib/           # Shared utilities, helpers, types
  domains/       # Business domains (each follows the layer model)
  providers/     # Cross-cutting concerns (auth, telemetry, flags)
  app/           # App wiring, routing, entry points
docs/            # All project knowledge
scripts/         # Developer and CI utilities
.github/         # CI/CD configuration
```

## Coding Conventions

- TypeScript strict mode (or equivalent strong typing)
- Structured logging only (no console.log in production)
- File size limit: 300 lines per file
- Descriptive file names: `user-auth.service.ts`, not `utils2.ts`
- Shared utilities in `src/lib/`, not per-feature
- All environment variables validated at startup
- PR titles: `<type>: <description>` (feat, fix, refactor, docs, test, chore)

## Documentation Map

| Document | Purpose |
|---|---|
| ARCHITECTURE.md | System structure, domains, layers, dependencies |
| docs/DESIGN.md | Design system, UI patterns, component conventions |
| docs/QUALITY.md | Quality grades per domain, known gaps |
| docs/PLANS.md | Active plans index, tech debt tracker |
| docs/RELIABILITY.md | Error handling, logging, observability patterns |
| docs/SECURITY.md | Auth, permissions, data handling rules |
| docs/PRODUCT.md | Product sense, user context, business logic |
| docs/design-docs/ | Design decisions, ADRs, core beliefs |
| docs/exec-plans/ | Execution plans with progress logs |
| docs/product-specs/ | Feature specs and acceptance criteria |
| docs/references/ | External docs bundled for agent context |

## Quality Scripts

Run these to validate your changes:

- `./scripts/quality-scan.sh` — file sizes, console.log, TODOs, secrets, required docs
- `./scripts/arch-lint.sh` — layer dependency violations
- `./scripts/doc-check.sh` — required docs present, no broken links

## Execution Plans

For complex multi-step work:
1. Check `docs/exec-plans/active/` for related work in progress
2. Create a new plan from `docs/exec-plans/TEMPLATE.md`
3. Break work into phases — each phase produces a mergeable PR
4. Move completed plans to `docs/exec-plans/completed/`

## When You're Stuck

1. Re-read the relevant doc from the Documentation Map above
2. Check `docs/design-docs/core-beliefs.md` for guiding principles
3. Check `docs/exec-plans/active/` for current plan context
4. If a pattern exists elsewhere in the codebase, follow it
5. If no pattern exists, document your decision in a design doc
