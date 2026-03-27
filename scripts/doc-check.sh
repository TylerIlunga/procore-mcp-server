#!/usr/bin/env bash
# Validates documentation structure and cross-links
# Run: ./scripts/doc-check.sh

set -euo pipefail

ISSUES=0
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo "=== Documentation Check ==="
echo ""

# Required files
REQUIRED_DOCS=(
  "CLAUDE.md"
  "AGENTS.md"
  "ARCHITECTURE.md"
  "docs/DESIGN.md"
  "docs/QUALITY.md"
  "docs/PLANS.md"
  "docs/RELIABILITY.md"
  "docs/SECURITY.md"
  "docs/PRODUCT.md"
  "docs/design-docs/index.md"
  "docs/design-docs/core-beliefs.md"
  "docs/product-specs/index.md"
  "docs/exec-plans/tech-debt-tracker.md"
)

echo "--- Checking required documentation files ---"
for doc in "${REQUIRED_DOCS[@]}"; do
  if [ -f "$doc" ]; then
    echo -e "${GREEN}  OK${NC} $doc"
  else
    echo -e "${RED}  MISSING${NC} $doc"
    echo "         FIX: Create this file. See CLAUDE.md Documentation Map for expected content and purpose."
    ISSUES=$((ISSUES + 1))
  fi
done

# Check for broken internal links in markdown files
echo ""
echo "--- Checking for broken internal links ---"
while IFS= read -r mdfile; do
  # Extract markdown links like [text](./path)
  while IFS= read -r link; do
    # Skip external links and anchors
    if [[ "$link" == http* ]] || [[ "$link" == "#"* ]] || [[ -z "$link" ]]; then
      continue
    fi
    # Resolve relative to the markdown file's directory
    dir=$(dirname "$mdfile")
    target="$dir/$link"
    # Remove any anchor fragments
    target="${target%%#*}"
    if [ ! -e "$target" ]; then
      echo -e "${YELLOW}  BROKEN LINK${NC} in $mdfile -> $link"
      echo "         FIX: Update the link target in $mdfile or create the missing file at $link."
      ISSUES=$((ISSUES + 1))
    fi
  done < <(grep -oP '\[.*?\]\(\K[^)]+' "$mdfile" 2>/dev/null || true)
done < <(find . -name "*.md" -not -path "./node_modules/*" -not -path "./.git/*" 2>/dev/null)

echo ""
if [ "$ISSUES" -gt 0 ]; then
  echo -e "${YELLOW}Found $ISSUES issue(s).${NC}"
  exit 1
else
  echo -e "${GREEN}All documentation checks passed.${NC}"
fi
