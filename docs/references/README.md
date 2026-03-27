# References

This directory bundles external documentation for agent context. Agents can't browse the web, so relevant external docs are stored here.

## What to Include

- `llms.txt` files from key dependencies
- API documentation for external services you integrate with
- Framework guides relevant to your stack
- Style guides or design system docs

## Naming Convention

Use descriptive names with the source: `{source}-{topic}.md`

Examples:
- `supabase-auth.md`
- `nextjs-app-router.md`
- `stripe-webhooks.md`

## How to Fetch

1. Check if the dependency publishes an `llms.txt` (e.g., `https://example.com/llms.txt`)
2. If not, copy the relevant sections from their docs
3. Keep files focused — include only what agents need for this project, not entire doc sites

## Maintenance

- Update when you upgrade a major dependency version
- Remove references for dependencies you no longer use
- Keep files under 500 lines — link to subsections if needed
