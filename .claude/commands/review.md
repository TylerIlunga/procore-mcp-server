Run a self-review on the current changes before opening a PR.

Follow the checklist in `.claude/skills/review.md`:
1. Architecture review — verify layer dependency rules
2. Code quality review — file sizes, logging, naming, no dead code
3. Test review — new behavior has tests, bug fixes have regression tests
4. Documentation review — affected docs are updated
5. Security review — input validation, parameterized queries, auth checks

Report a summary of findings with pass/fail per section.
