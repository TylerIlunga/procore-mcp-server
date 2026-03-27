#!/usr/bin/env bash
# Initial project setup: run once after cloning the starter repo
# Usage: ./scripts/setup.sh "My Project Name" "web app" "Next.js, TypeScript, Tailwind"

set -euo pipefail

PROJECT_NAME="${1:-}"
PROJECT_TYPE="${2:-}"
PROJECT_STACK="${3:-}"

if [ -z "$PROJECT_NAME" ]; then
  echo "Usage: ./scripts/setup.sh \"Project Name\" \"project type\" \"tech stack\""
  echo ""
  echo "Example: ./scripts/setup.sh \"Acme Dashboard\" \"web app\" \"Next.js, TypeScript, Tailwind, Supabase\""
  exit 1
fi

echo "=== Setting up: $PROJECT_NAME ==="

# Update CLAUDE.md with project info
if [ -f "CLAUDE.md" ]; then
  sed -i.bak "s/\[PROJECT_NAME\]/$PROJECT_NAME/g" CLAUDE.md
  [ -n "$PROJECT_TYPE" ] && sed -i.bak "s/\[web app | API | CLI | library | mobile app\]/$PROJECT_TYPE/g" CLAUDE.md
  [ -n "$PROJECT_STACK" ] && sed -i.bak "s/\[e.g., Next.js, TypeScript, Tailwind, Supabase\]/$PROJECT_STACK/g" CLAUDE.md
  sed -i.bak "s/\[scaffold | active development | beta | production\]/scaffold/g" CLAUDE.md
  rm -f CLAUDE.md.bak
  echo "  Updated CLAUDE.md"
fi

# Update AGENTS.md with project info
if [ -f "AGENTS.md" ]; then
  sed -i.bak "s/\[PROJECT_NAME\]/$PROJECT_NAME/g" AGENTS.md
  [ -n "$PROJECT_TYPE" ] && sed -i.bak "s/\[web app | API | CLI | library | mobile app\]/$PROJECT_TYPE/g" AGENTS.md
  [ -n "$PROJECT_STACK" ] && sed -i.bak "s/\[e.g., Next.js, TypeScript, Tailwind, Supabase\]/$PROJECT_STACK/g" AGENTS.md
  rm -f AGENTS.md.bak
  echo "  Updated AGENTS.md"
fi

# Initialize git if not already a repo
if [ ! -d ".git" ]; then
  git init
  echo "  Initialized git repository"
fi

# Make scripts executable
chmod +x scripts/*.sh
echo "  Made scripts executable"

# Create .env.example
if [ ! -f ".env.example" ]; then
  cat > .env.example << 'ENVEOF'
# Copy to .env and fill in values
# All variables listed here must be validated at application startup

# NODE_ENV=development
# DATABASE_URL=
# API_KEY=
ENVEOF
  echo "  Created .env.example"
fi

echo ""
echo "Setup complete! Next steps:"
echo "  1. Review and customize CLAUDE.md"
echo "  2. Update ARCHITECTURE.md for your system"
echo "  3. Fill in docs/PRODUCT.md with your product context"
echo "  4. Initialize your application in src/"
echo "  5. Run: git add -A && git commit -m 'Initial scaffold from agent-starter'"
