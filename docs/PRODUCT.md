# Product

## What it does

Lets an AI assistant read and write a Procore account (projects, RFIs,
submittals, budgets, daily logs, documents, and so on) through the Model
Context Protocol, with no hand-written integration per endpoint. Every
operation in Procore's public REST API is reachable.

## Users

| Persona | Goal |
|---|---|
| Construction PM / project engineer | Ask questions of project data and draft updates (RFIs, logs) from Claude |
| Developer / integrator | Explore the Procore API interactively before writing an integration |

The server is single-user: it acts as whichever Procore user ran `npm run auth`,
with that user's permissions.

## Core journeys

1. **Discover, then call:** `procore_discover_categories` or `procore_search_endpoints`
   → `procore_get_endpoint_details` → `procore_call_api`.
2. **Set context once:** `procore_set_config` with `company_id`/`project_id`, so later
   calls can omit them.
3. **Direct tools (`PROCORE_TOOL_MODE=all`):** call a generated per-endpoint tool such
   as `list_rfis` directly.

## Business rules

| Rule | Enforcement |
|---|---|
| Most Procore endpoints need `company_id`; project endpoints need `project_id` too | Config fallback (`PROCORE_COMPANY_ID`, `procore_set_config`); Procore returns 4xx otherwise |
| Writes act on live data with the user's permissions | MCP annotations mark destructive and non-idempotent tools |
| Deprecated endpoints keep working until Procore's removal date | Descriptions carry the deprecation notice from the spec |

## Glossary

| Term | Meaning |
|---|---|
| OAS | Procore's combined OpenAPI spec, the input to the build |
| Catalog | Generated endpoint index in `data/` |
| Manifest | `data/tools-manifest.json`, one generated tool per endpoint |
| Meta tools | The 7 `procore_*` discovery and execution tools |
| TDQS | Glama's Tool Definition Quality Score for tool descriptions |
