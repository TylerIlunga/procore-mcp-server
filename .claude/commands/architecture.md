Validate architecture rules across the codebase.

1. Run `./scripts/arch-lint.sh` to check layer dependency violations
2. Manually verify:
   - Cross-domain imports go through the Service layer only
   - No circular dependencies between domains
   - Shared utilities live in `src/lib/`, not duplicated per domain
   - Providers handle cross-cutting concerns (auth, telemetry, flags)
3. Check that any new files follow the naming conventions in `ARCHITECTURE.md`

Report violations with specific file paths and suggested fixes.
