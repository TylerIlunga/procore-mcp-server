#!/usr/bin/env bash
# Architecture linter: enforces layer dependency rules
# Run: ./scripts/arch-lint.sh
#
# Validates that domain code follows the layered architecture:
# Types -> Config -> Repository -> Service -> Runtime -> UI
#
# Customize the LAYERS array and import patterns for your stack.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ISSUES=0
DOMAINS_DIR="src/domains"

# Layer order (index = rank, lower can't import higher)
declare -a LAYERS=("types" "config" "repository" "service" "runtime" "ui")

get_layer_rank() {
  local layer="$1"
  for i in "${!LAYERS[@]}"; do
    if [[ "${LAYERS[$i]}" == "$layer" ]]; then
      echo "$i"
      return
    fi
  done
  echo "-1"
}

echo "=== Architecture Lint ==="
echo ""

if [ ! -d "$DOMAINS_DIR" ]; then
  echo "No domains directory found at $DOMAINS_DIR. Skipping."
  echo "Create domain directories to enable architecture linting."
  exit 0
fi

# Check each domain directory
for domain_dir in "$DOMAINS_DIR"/*/; do
  domain=$(basename "$domain_dir")
  echo "--- Domain: $domain ---"

  # Check each source file in the domain
  while IFS= read -r file; do
    filename=$(basename "$file" | sed 's/\.[^.]*$//')

    # Determine which layer this file belongs to
    file_layer=""
    for layer in "${LAYERS[@]}"; do
      if [[ "$filename" == "$layer" ]] || [[ "$filename" == "$layer".* ]] || [[ "$filename" == *-"$layer" ]] || [[ "$filename" == *-"$layer".* ]] || [[ "$(dirname "$file")" == *"/$layer/"* ]] || [[ "$(dirname "$file")" == *"/$layer" ]]; then
        file_layer="$layer"
        break
      fi
    done

    if [ -z "$file_layer" ]; then
      continue
    fi

    file_rank=$(get_layer_rank "$file_layer")

    # Check imports in this file for layer violations
    while IFS= read -r import_line; do
      for layer in "${LAYERS[@]}"; do
        if echo "$import_line" | grep -q "/$layer" 2>/dev/null; then
          import_rank=$(get_layer_rank "$layer")
          if [ "$import_rank" -gt "$file_rank" ]; then
            echo -e "${RED}  VIOLATION${NC} $file ($file_layer) imports from $layer layer"
            echo "    $import_line"
            echo "    FIX: Move the imported code to the $file_layer layer or a lower layer, or use a Provider for cross-cutting concerns."
            ISSUES=$((ISSUES + 1))
          fi
        fi
      done
    done < <(grep -E "^import |^from " "$file" 2>/dev/null || true)

  done < <(find "$domain_dir" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" \) 2>/dev/null || true)
done

echo ""
if [ "$ISSUES" -gt 0 ]; then
  echo -e "${RED}Found $ISSUES architecture violation(s).${NC}"
  echo ""
  echo "Layer dependency rules (can only import from layers above):"
  echo "  Types -> Config -> Repository -> Service -> Runtime -> UI"
  echo ""
  echo "Fix: Move shared code to the appropriate lower layer or use Providers for cross-cutting concerns."
  exit 1
else
  echo -e "${GREEN}No architecture violations found.${NC}"
fi
