# Skill: Codebase Cleanup (Garbage Collection)

Run periodic cleanup to prevent drift and maintain quality.

## Scan Checklist

1. **Large files:** Find files exceeding 300 lines and split them
2. **Duplicated patterns:** Find similar code that should be extracted to `src/lib/`
3. **Console.log:** Replace with structured logging
4. **Dead code:** Remove unused exports, functions, and files
5. **TODO/FIXME comments:** Convert to tech debt tracker entries or resolve
6. **Stale docs:** Check if documentation reflects actual code behavior
7. **Test coverage:** Identify untested critical paths
8. **Naming consistency:** Ensure consistent naming conventions across domains
9. **Import organization:** Clean up import order and remove unused imports
10. **Type safety:** Find `any` types and replace with proper types

## Process

1. Run `./scripts/quality-scan.sh` to identify issues
2. Run `./scripts/arch-lint.sh` to check architecture violations
3. Run `./scripts/doc-check.sh` to validate documentation
4. For each issue found, create a focused fix PR
5. Update `docs/QUALITY.md` scorecard after cleanup
6. Update `docs/exec-plans/tech-debt-tracker.md` for items that need follow-up
