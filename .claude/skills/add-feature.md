# Skill: Add Feature

Structured workflow for implementing a new feature.

## Steps

1. **Read the spec:** Check `docs/product-specs/` for the feature spec. If none exists, create one first.

2. **Understand context:**
   - Read `docs/PRODUCT.md` for product context
   - Read `ARCHITECTURE.md` for system structure
   - Identify which domain(s) this feature touches

3. **Plan the work:**
   - If multi-PR, create an execution plan in `docs/exec-plans/active/`
   - If single-PR, proceed directly

4. **Implement following the layer model:**
   - Start with Types (schemas, interfaces)
   - Then Config (if needed)
   - Then Repository (data access)
   - Then Service (business logic)
   - Then UI (if applicable)
   - Cross-cutting concerns go through Providers

5. **Write tests alongside code:**
   - Unit tests for service logic
   - Integration tests for critical paths
   - UI tests for user-facing features

6. **Validate:**
   - Run the test suite
   - Run `./scripts/quality-scan.sh`
   - Run `./scripts/arch-lint.sh`
   - Self-review using the review skill

7. **Document:**
   - Update relevant docs if patterns changed
   - Update quality scorecard if appropriate
   - Log decisions in design docs if significant

8. **Open PR** with clear description and test plan
