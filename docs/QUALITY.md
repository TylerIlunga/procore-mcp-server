<!-- Article equivalent: QUALITY_SCORE.md — shorter filename chosen for cleaner imports -->
# Quality Scorecard

Track quality grades per domain and layer. Update regularly.

## Grading Scale

- **A** - Well-tested, documented, clean patterns, no known issues
- **B** - Functional with tests, minor gaps in docs or edge cases
- **C** - Works but missing tests, docs, or has known tech debt
- **D** - Fragile, poorly tested, needs significant refactoring
- **F** - Broken or unmaintained

## Domain Grades

| Domain | Types | Config | Repo | Service | UI | Tests | Docs | Overall |
|---|---|---|---|---|---|---|---|---|
| [domain-1] | - | - | - | - | - | - | - | - |
| [domain-2] | - | - | - | - | - | - | - | - |
| Shared/Lib | - | - | - | - | - | - | - | - |

## Known Quality Gaps

<!-- Track specific issues that need attention -->

| Area | Issue | Priority | Plan |
|---|---|---|---|
| | | | |

## Quality Principles

1. **Every bug fix includes a regression test.**
2. **New features ship with unit tests at minimum.**
3. **Integration tests cover critical user journeys.**
4. **No warnings in CI output.** Treat warnings as errors.
5. **Structured logging only.** No console.log in production paths.

## Recurring Quality Tasks

These should run on a regular cadence (daily/weekly):

- [ ] Scan for files exceeding 300-line limit
- [ ] Check for unused exports and dead code
- [ ] Verify all domains follow the layered architecture
- [ ] Ensure test coverage hasn't regressed
- [ ] Review and update this scorecard
