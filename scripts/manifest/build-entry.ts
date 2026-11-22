/**
 * One catalog entry + its endpoint detail file -> one tool manifest entry,
 * plus the filter for endpoints that cannot be agent-callable tools at all.
 */
import { truncate } from "../shared/truncate.js";
import type { CatalogEntry, EndpointDetail } from "../catalog/types.js";
import { enrichParamDescription } from "./param-enrichment.js";
import {
  type ToolParam,
  mapOasTypeToSimple,
  extractBodyParams,
  dedupeParams,
} from "./params.js";
import { summaryToToolName } from "./naming.js";
import type { ToolManifestEntry } from "./types.js";

export function buildManifestEntry(
  entry: CatalogEntry,
  detail: EndpointDetail
): ToolManifestEntry {
  const toolName = summaryToToolName(
    entry.summary,
    entry.method,
    entry.path,
    entry.version
  );

  const params: ToolParam[] = [];

  // Path and query params (excluding Procore-Company-Id header)
  for (const p of detail.parameters) {
    if (p.name === "Procore-Company-Id" && p.in === "header") continue;
    const rawDesc = truncate(p.description || p.name, 200);
    params.push({
      name: p.name,
      type: mapOasTypeToSimple(p.schema || {}),
      required: p.required,
      description: enrichParamDescription(p.name, rawDesc, entry.module),
      enum: p.schema?.enum as unknown[] | undefined,
      source: p.in as "path" | "query",
    });
  }

  // Body params
  let bodyWrapper: string | undefined;
  if (detail.requestBody?.schema) {
    const { params: bodyParams, wrapper } = extractBodyParams(
      detail.requestBody.schema,
      entry.module
    );
    bodyWrapper = wrapper;
    params.push(...bodyParams);
  }

  return {
    toolName,
    operationId: entry.operationId,
    method: entry.method,
    path: entry.path,
    summary: entry.summary,
    // Matches the catalog's own limit on this same text
    // (scripts/catalog/detail-files.ts) -- a second, tighter truncation here
    // silently undid that one, re-severing markdown tables (file-format
    // lists, mainly) that already fit within 1600.
    description: truncate(detail.description || entry.summary, 1600),
    category: entry.category,
    module: entry.module,
    version: entry.version,
    contentType: entry.contentType,
    params: dedupeParams(params),
    bodyWrapper,
    returnsCollection: entry.returnsCollection,
    collectionEnvelope: entry.collectionEnvelope,
    deprecated: entry.deprecated,
    deprecatedAt: entry.deprecatedAt,
    sunset: entry.sunset,
  };
}

/**
 * Endpoints that cannot function as agent-callable tools. The `/oauth/*` family
 * drives an interactive browser redirect and token exchange that `src/auth/`
 * already owns end to end: `/oauth/authorize` answers with an HTML redirect
 * rather than JSON, and revoking or re-minting a token mid-session would break
 * the server's own credentials. They stay reachable through `procore_api_call`
 * for anyone who genuinely needs them.
 */
export function isNonCallable(entry: CatalogEntry): boolean {
  return entry.path.startsWith("/oauth");
}
