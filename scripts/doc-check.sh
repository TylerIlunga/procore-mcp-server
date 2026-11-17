#!/usr/bin/env bash
# Validates that the agent-facing docs exist and their relative links resolve.
# Run: ./scripts/doc-check.sh

set -euo pipefail

ISSUES=0
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo "=== Documentation Check ==="

REQUIRED_DOCS=(
  "README.md"
  "CLAUDE.md"
  "AGENTS.md"
  "ARCHITECTURE.md"
  "docs/PRODUCT.md"
  "docs/QUALITY.md"
  "docs/RELIABILITY.md"
  "docs/SECURITY.md"
)

echo "--- Required files ---"
for doc in "${REQUIRED_DOCS[@]}"; do
  if [ ! -f "$doc" ]; then
    echo -e "${RED}  MISSING${NC} $doc"
    ISSUES=$((ISSUES + 1))
  fi
done

# Unfilled template placeholders left behind by the scaffold.
echo "--- Template placeholders ---"
PLACEHOLDERS=$(grep -nE '\[PROJECT_NAME\]|<!-- (Replace|Describe|Define|List|Document|Track|Record)' \
  "${REQUIRED_DOCS[@]}" 2>/dev/null || true)
if [ -n "$PLACEHOLDERS" ]; then
  echo -e "${RED}  Unfilled template text:${NC}"
  echo "$PLACEHOLDERS"
  ISSUES=$((ISSUES + 1))
fi

# Relative markdown links in tracked docs. grep -oE (not -P) so this runs on
# macOS/BSD grep as well as GNU grep in CI.
echo "--- Relative links ---"
while IFS= read -r mdfile; do
  while IFS= read -r link; do
    link="${link%%#*}"
    case "$link" in ""|http*|mailto:*) continue ;; esac
    if [ ! -e "$(dirname "$mdfile")/$link" ]; then
      echo -e "${YELLOW}  BROKEN LINK${NC} in $mdfile -> $link"
      ISSUES=$((ISSUES + 1))
    fi
  done < <(grep -oE '\]\([^)]+\)' "$mdfile" | sed -E 's/^\]\(//; s/\)$//; s/[[:space:]].*$//' || true)
done < <(git ls-files --cached --others --exclude-standard '*.md')

if [ "$ISSUES" -gt 0 ]; then
  echo -e "${YELLOW}Found $ISSUES issue(s).${NC}"
  exit 1
fi
echo -e "${GREEN}All documentation checks passed.${NC}"
