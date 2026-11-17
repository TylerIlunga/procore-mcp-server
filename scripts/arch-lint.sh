#!/usr/bin/env bash
# Architecture linter: enforces the module dependency direction in src/.
# Run: ./scripts/arch-lint.sh
#
#   auth  <-  api  <-  tools  ->  catalog
#
# - src/auth/    may import nothing else in src/ (it is the bottom layer)
# - src/catalog/ may import nothing else in src/ (pure, loads data/ only)
# - src/api/     may import src/auth/ only
# - src/tools/   may import any of the above
# - nothing in src/ may import scripts/ (build-time code never ships)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ISSUES=0

# module -> space-separated list of src/ modules it may import from
allowed_for() {
  case "$1" in
    auth)    echo "" ;;
    catalog) echo "" ;;
    api)     echo "auth" ;;
    tools)   echo "auth api catalog" ;;
    *)       echo "*" ;;
  esac
}

echo "=== Architecture Lint ==="

for module_dir in src/*/; do
  module=$(basename "$module_dir")
  allowed=$(allowed_for "$module")
  [ "$allowed" = "*" ] && continue

  while IFS= read -r hit; do
    file="${hit%%:*}"
    spec=$(echo "$hit" | sed -E "s/.*from ['\"]([^'\"]+)['\"].*|.*import\(['\"]([^'\"]+)['\"]\).*/\1\2/")
    # Resolve the import to a path relative to the repo root.
    target=$(cd "$(dirname "$file")" && python3 -c 'import os,sys; print(os.path.relpath(os.path.normpath(os.path.join(os.getcwd(), sys.argv[1])), sys.argv[2]))' "$spec" "$OLDPWD")

    case "$target" in
      scripts/*)
        echo -e "${RED}  VIOLATION${NC} $file imports build-time code: $spec"
        ISSUES=$((ISSUES + 1)); continue ;;
      src/"$module"/*) continue ;;
      src/*/*)
        dep=$(echo "$target" | cut -d/ -f2)
        if [[ " $allowed " != *" $dep "* ]]; then
          echo -e "${RED}  VIOLATION${NC} $file ($module) imports from src/$dep: $spec"
          echo "    Allowed for $module: ${allowed:-nothing outside itself}"
          ISSUES=$((ISSUES + 1))
        fi ;;
    esac
  done < <(grep -rnoE "from ['\"]\.\.?/[^'\"]+['\"]|import\(['\"]\.\.?/[^'\"]+['\"]\)" "$module_dir" --include='*.ts' || true)
done

if [ "$ISSUES" -gt 0 ]; then
  echo -e "${RED}Found $ISSUES architecture violation(s).${NC}"
  exit 1
fi
echo -e "${GREEN}No architecture violations found.${NC}"
