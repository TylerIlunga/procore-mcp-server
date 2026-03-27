# Skill: Refactor

Structured workflow for safely refactoring code without changing behavior.

## Steps

1. **Define the goal:** What specific improvement are you making? (extract module, rename, restructure, reduce duplication, etc.)

2. **Verify tests pass:** Run the full test suite before touching anything. If tests don't pass, fix them first.

3. **Plan changes:**
   - Identify all files that will be affected
   - Check for downstream consumers of code being moved/renamed
   - Ensure the refactor stays within one domain when possible

4. **Execute incrementally:**
   - Make one logical change at a time
   - Run tests after each change
   - Keep each step independently mergeable if possible

5. **Validate no behavior change:**
   - All existing tests still pass
   - Run `./scripts/quality-scan.sh`
   - Run `./scripts/arch-lint.sh`
   - No new warnings or errors

6. **Document:**
   - If architecture changed, update `ARCHITECTURE.md`
   - If patterns changed, update the relevant doc
   - Add a design doc entry if the refactor was significant

7. **Open PR** with:
   - Clear description of what was refactored and why
   - Confirmation that no behavior changed
   - Test plan showing all tests pass
