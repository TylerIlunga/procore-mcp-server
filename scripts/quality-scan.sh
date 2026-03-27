#!/usr/bin/env bash
# Quality scan: checks for common issues that agents should fix
# Run: ./scripts/quality-scan.sh

set -euo pipefail

ISSUES=0
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "=== Quality Scan ==="
echo ""

# Check for files exceeding line limit
echo "--- Checking file sizes (max 300 lines) ---"
while IFS= read -r file; do
  lines=$(wc -l < "$file")
  if [ "$lines" -gt 300 ]; then
    echo -e "${YELLOW}WARNING: $file has $lines lines (limit: 300)${NC}"
    echo "  FIX: Split this file into smaller, focused modules. Extract related functions into separate files."
    ISSUES=$((ISSUES + 1))
  fi
done < <(find src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" \) 2>/dev/null || true)

# Check for console.log in source files
echo "--- Checking for console.log in source code ---"
CONSOLE_LOGS=$(grep -rn "console\.log" src --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null | grep -v "node_modules" | grep -v ".test." || true)
if [ -n "$CONSOLE_LOGS" ]; then
  echo -e "${YELLOW}WARNING: Found console.log usage (use structured logging):${NC}"
  echo "$CONSOLE_LOGS"
  echo "  FIX: Replace console.log with structured logging per docs/RELIABILITY.md. Use your logging utility in src/lib/."
  ISSUES=$((ISSUES + 1))
fi

# Check for TODO/FIXME/HACK comments
echo "--- Checking for TODO/FIXME/HACK comments ---"
TODOS=$(grep -rn "TODO\|FIXME\|HACK\|XXX" src --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" 2>/dev/null | grep -v "node_modules" || true)
if [ -n "$TODOS" ]; then
  echo -e "${YELLOW}NOTE: Found TODO/FIXME comments (consider tracking as tech debt):${NC}"
  echo "$TODOS"
fi

# Check for .env files that shouldn't be committed
echo "--- Checking for secrets ---"
if [ -f ".env" ] && ! grep -q "^\.env$" .gitignore 2>/dev/null; then
  echo -e "${RED}ERROR: .env file exists but not in .gitignore${NC}"
  echo "  FIX: Add '.env' to .gitignore immediately. Never commit secrets to the repository."
  ISSUES=$((ISSUES + 1))
fi

# Check docs freshness
echo "--- Checking documentation ---"
for doc in CLAUDE.md ARCHITECTURE.md docs/QUALITY.md docs/PLANS.md; do
  if [ ! -f "$doc" ]; then
    echo -e "${YELLOW}WARNING: Missing required doc: $doc${NC}"
    echo "  FIX: Create $doc using the templates in the repo. See CLAUDE.md Documentation Map for expected content."
    ISSUES=$((ISSUES + 1))
  fi
done

echo ""
if [ "$ISSUES" -gt 0 ]; then
  echo -e "${YELLOW}Found $ISSUES issue(s). Run the appropriate fixes.${NC}"
  exit 1
else
  echo -e "${GREEN}All checks passed.${NC}"
fi
