Run a garbage collection pass on the codebase.

Follow the workflow in `.claude/skills/cleanup.md`:
1. Run `./scripts/quality-scan.sh` to identify issues
2. Run `./scripts/arch-lint.sh` to check architecture violations
3. Run `./scripts/doc-check.sh` to validate documentation
4. Scan for: large files, duplicated patterns, console.log, dead code, stale TODOs, type safety gaps
5. For each issue found, fix it or log it in `docs/exec-plans/tech-debt-tracker.md`
6. Update `docs/QUALITY.md` scorecard after cleanup
