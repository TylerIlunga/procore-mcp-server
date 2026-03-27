# Skill: Create Execution Plan

When starting complex multi-PR work, create an execution plan:

## Steps

1. **Assess scope:** Understand the full scope of what needs to change
2. **Read existing plans:** Check `docs/exec-plans/active/` for related work
3. **Create plan file:** Copy `docs/exec-plans/TEMPLATE.md` to `docs/exec-plans/active/YYYY-MM-DD-descriptive-name.md`
4. **Define acceptance criteria:** Clear, testable criteria for "done"
5. **Break into phases:** Each phase should produce a mergeable PR
6. **Identify risks:** What could go wrong? What are the dependencies?
7. **Update index:** Add entry to `docs/PLANS.md`
8. **Start execution:** Begin with Phase 1

## Guidelines

- Each phase should be independently mergeable
- Prefer smaller, focused PRs over large omnibus changes
- Update the progress log after each PR
- If blocked, document the blocker and pivot
- Move completed plans to `docs/exec-plans/completed/`
