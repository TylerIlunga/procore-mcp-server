#!/usr/bin/env bash
# Quality scan for repo conventions that tsc and npm test don't catch.
# Run: ./scripts/quality-scan.sh

set -euo pipefail

ISSUES=0
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "=== Quality Scan ==="

# 300-line limit (CLAUDE.md coding conventions). Applies to the server code in
# src/ and to the build-time scripts in scripts/ (including its subfolders).
echo "--- File sizes in src/ and scripts/ (max 300 lines) ---"
while IFS= read -r file; do
  lines=$(wc -l < "$file" | tr -d ' ')
  if [ "$lines" -gt 300 ]; then
    echo -e "${RED}  OVER LIMIT${NC} $file has $lines lines"
    echo "    FIX: extract a focused module (see src/tools/sentence-trim.ts or scripts/catalog/ for the pattern)."
    ISSUES=$((ISSUES + 1))
  fi
done < <(find src scripts -type f \( -name '*.ts' -o -name '*.sh' \))

# The MCP server speaks JSON-RPC over stdout (stdio transport). Any stray
# console.log in server code corrupts the protocol stream. Use console.error
# (stderr) for diagnostics. src/auth/setup.ts is the interactive `npm run auth`
# CLI, which never runs inside the server, so stdout is fine there.
echo "--- stdout writes in server code ---"
STDOUT_HITS=$(grep -rnE 'console\.(log|info)\(|process\.stdout\.write' src --include='*.ts' \
  | grep -v '^src/auth/setup.ts:' || true)
if [ -n "$STDOUT_HITS" ]; then
  echo -e "${RED}  stdout write in server code (breaks the stdio transport):${NC}"
  echo "$STDOUT_HITS"
  echo "    FIX: use console.error for diagnostics."
  ISSUES=$((ISSUES + 1))
fi

echo "--- Secrets ---"
for f in .env .mcp.json; do
  if [ -f "$f" ] && ! git check-ignore -q "$f"; then
    echo -e "${RED}  $f exists but is not gitignored${NC}"
    ISSUES=$((ISSUES + 1))
  fi
done
if git ls-files | grep -qE '(^|/)tokens\.json$'; then
  echo -e "${RED}  a tokens.json is tracked by git${NC}"
  ISSUES=$((ISSUES + 1))
fi

echo "--- TODO/FIXME (informational) ---"
grep -rnE 'TODO|FIXME|HACK|XXX' src --include='*.ts' || echo "  none"

echo ""
if [ "$ISSUES" -gt 0 ]; then
  echo -e "${YELLOW}Found $ISSUES issue(s).${NC}"
  exit 1
fi
echo -e "${GREEN}All checks passed.${NC}"
