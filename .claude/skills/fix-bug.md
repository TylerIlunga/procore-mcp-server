# Skill: Fix Bug

Structured workflow for diagnosing and fixing bugs.

## Steps

1. **Reproduce the bug:**
   - Understand the expected vs. actual behavior
   - Identify the minimal reproduction steps
   - If the app has a UI, launch it and reproduce visually

2. **Diagnose root cause:**
   - Trace the code path from the symptom to the source
   - Check logs and error messages
   - Don't just fix the symptom - find the root cause

3. **Write a failing test first:**
   - Create a test that reproduces the bug
   - Confirm it fails before implementing the fix

4. **Implement the fix:**
   - Make the minimal change needed
   - Don't refactor unrelated code in the same PR
   - Follow existing patterns in the codebase

5. **Verify:**
   - The failing test now passes
   - All existing tests still pass
   - Run `./scripts/quality-scan.sh`
   - Manually verify if UI-related

6. **Document:**
   - If the bug revealed a missing architectural constraint, add it
   - If it exposed a gap in validation, add the validation
   - Update quality scorecard if relevant

7. **Open PR** with:
   - Description of the bug and root cause
   - What was changed and why
   - Test plan showing the fix works
