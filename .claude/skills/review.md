# Skill: Agent Self-Review

When reviewing your own changes before opening a PR, follow this checklist:

## Architecture Review
1. Check that all imports follow the layer dependency rules (Types -> Config -> Repo -> Service -> Runtime -> UI)
2. Verify no circular dependencies between domains
3. Confirm shared code lives in `src/lib/`, not duplicated across domains

## Code Quality Review
1. No files exceed 300 lines
2. No console.log in production code (use structured logging)
3. All external data is validated at the boundary
4. No hardcoded secrets or credentials
5. Functions have clear, descriptive names
6. No commented-out code blocks

## Test Review
1. New behavior has corresponding tests
2. Bug fixes include regression tests
3. Tests are independent and don't rely on execution order
4. Test names describe the expected behavior

## Documentation Review
1. If architecture changed, update ARCHITECTURE.md
2. If new patterns introduced, document in relevant doc
3. If design decisions made, create/update design doc
4. Quality scorecard reflects current state

## Security Review
1. Input validation on all new endpoints
2. Parameterized queries (no string interpolation for SQL)
3. Output encoding for user-generated content
4. Auth checks on protected routes
