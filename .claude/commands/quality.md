Run all three quality scripts and report a unified summary.

Execute in order:
1. `./scripts/quality-scan.sh` — file sizes, console.log, TODOs, secrets, required docs
2. `./scripts/arch-lint.sh` — layer dependency violations
3. `./scripts/doc-check.sh` — required docs present, no broken internal links

If any script reports issues, list them grouped by script with the suggested fix for each.
