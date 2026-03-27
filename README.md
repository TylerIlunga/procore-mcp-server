# Agent Starter

A starter repository template for building software with AI coding agents (Claude Code, Codex, etc.).

Based on the principles from [Harness Engineering: Leveraging Codex in an Agent-First World](https://openai.com/index/harness-engineering/) — adapted for Claude Code with skills, subagents, and structured documentation.

## Philosophy

**Humans steer. Agents execute.**

This repo provides the scaffolding that makes agents effective:
- **Structured knowledge base** — the repo is the system of record, not Slack or Google Docs
- **Progressive disclosure** — CLAUDE.md is a map (~100 lines), not a 1,000-page manual
- **Mechanical enforcement** — architecture rules, quality checks, and doc validation run automatically
- **Layered architecture** — strict boundaries + local autonomy
- **Continuous garbage collection** — recurring quality scans prevent drift

## Quick Start

```bash
# Clone the starter
git clone <this-repo-url> my-project
cd my-project

# Run setup with your project info
./scripts/setup.sh "My Project" "web app" "Next.js, TypeScript, Tailwind"

# Initialize git
git add -A && git commit -m "Initial scaffold from agent-starter"
```

## What's Included

```
CLAUDE.md                    # Agent entry point (map, not manual)
AGENTS.md                    # Codex compatibility (points to CLAUDE.md)
ARCHITECTURE.md              # System structure, domains, layer rules

docs/
  DESIGN.md                  # Design system and UI conventions
  QUALITY.md                 # Quality scorecard per domain
  PLANS.md                   # Active plans index
  RELIABILITY.md             # Error handling, logging, observability
  SECURITY.md                # Auth, validation, secrets
  PRODUCT.md                 # Product context, user journeys, glossary
  design-docs/
    index.md                 # Design decision index
    core-beliefs.md          # Foundational engineering principles
  exec-plans/
    TEMPLATE.md              # Plan template
    tech-debt-tracker.md     # Tech debt tracking
    active/                  # In-progress plans
    completed/               # Finished plans
  product-specs/
    index.md                 # Feature spec index
  references/                # Bundled external docs for agent context
  generated/                 # Auto-generated docs (DB schemas, etc.)

scripts/
  setup.sh                   # One-time project setup
  quality-scan.sh            # Code quality checks
  doc-check.sh               # Documentation structure validation
  arch-lint.sh               # Architecture layer enforcement

.claude/
  settings.json              # Claude Code project permissions
  skills/
    review.md                # Self-review checklist
    plan.md                  # Execution plan creation
    cleanup.md               # Codebase garbage collection
    add-feature.md           # Feature implementation workflow
    fix-bug.md               # Bug fix workflow

.github/workflows/
  ci.yml                     # CI pipeline (quality + tests)
  doc-gardening.yml          # Weekly doc freshness check
```

## Key Principles

1. **Repository = system of record.** If it's not committed, agents can't see it.
2. **Map, not manual.** CLAUDE.md stays ~100 lines. Details live in linked docs.
3. **Enforce boundaries, allow autonomy.** Strict layers + freedom within them.
4. **Parse at the boundary.** Validate external data at edges. Trust internal types.
5. **Boring tech wins.** Composable, stable, well-documented dependencies.
6. **Fix the environment, not the symptom.** Agent struggling? Add context or tooling, don't retry.
7. **Continuous garbage collection.** Small, frequent cleanups beat painful rewrites.

## Customization Guide

### After Cloning

1. **CLAUDE.md** — Fill in project name, type, stack, and customize quick-start commands
2. **ARCHITECTURE.md** — Define your actual system architecture and domains
3. **docs/PRODUCT.md** — Write your product context, user personas, and glossary
4. **docs/DESIGN.md** — Set your design tokens and component conventions
5. **.github/workflows/ci.yml** — Uncomment and configure the test/build jobs for your stack
6. **scripts/arch-lint.sh** — Adjust layer names and import patterns for your language

### Adding External Reference Docs

Bundle external documentation for agent context in `docs/references/`:
```bash
# Example: fetch llms.txt for a dependency
curl -o docs/references/supabase-llms.txt https://supabase.com/llms.txt
```

### Creating Domain Modules

Follow the layered architecture:
```bash
mkdir -p src/domains/users/{ui}
touch src/domains/users/{types,config,repository,service}.ts
touch src/domains/users/ui/index.ts
```

## Workflows

### Adding a Feature
```
Read the spec -> Plan -> Types -> Config -> Repo -> Service -> UI -> Test -> Review -> PR
```

### Fixing a Bug
```
Reproduce -> Diagnose root cause -> Write failing test -> Fix -> Verify -> PR
```

### Weekly Maintenance
```
Run quality scan -> Fix issues -> Update quality scorecard -> Review tech debt tracker
```

## License

MIT
