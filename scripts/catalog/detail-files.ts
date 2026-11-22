/**
 * Endpoint detail files (`data/endpoint-details/<operationId>.json`): build
 * one per operation, write it, and prune files for operations that have left
 * the spec.
 */
import { writeFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { truncate } from "../shared/truncate.js";
import { fixTypos } from "./typo-fixes.js";
import { simplifySchema } from "./simplify-schema.js";
import type { RequestBodyShape } from "./operation-params.js";
import type {
  CatalogEntry,
  EndpointDetail,
  OASOperation,
  OASParameter,
} from "./types.js";

export function buildEndpointDetail(
  operation: OASOperation,
  method: string,
  path: string,
  tag: string,
  dedupedParams: OASParameter[],
  body: RequestBodyShape
): EndpointDetail {
  const { contentType, hasRequestBody, requestBodySchema } = body;

  const detail: EndpointDetail = {
    operationId: operation.operationId,
    method: method.toUpperCase(),
    path,
    summary: fixTypos(operation.summary || ""),
    // 1600 comfortably fits all but a handful of Procore's longest
    // operation descriptions (file-format tables, mainly) without
    // truncation; the ones still cut fall back to trimToWholeSentence.
    // Must match the manifest's own limit on this same text
    // (scripts/manifest/build-entry.ts).
    description: truncate(fixTypos(operation.description || ""), 1600),
    tag,
    deprecated: operation.deprecated === true,
    deprecatedAt: operation["x-deprecated-at"],
    sunset: operation["x-sunset"],
    parameters: dedupedParams.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required || false,
      description: truncate(fixTypos(p.description || ""), 200),
      schema: simplifySchema(p.schema as Record<string, unknown>),
    })),
    responses: {},
  };

  if (hasRequestBody && requestBodySchema) {
    detail.requestBody = {
      contentType: contentType!,
      required: operation.requestBody?.required || false,
      schema: simplifySchema(requestBodySchema, 0),
    };
  }

  // Extract response schemas (only 200/201)
  if (operation.responses) {
    for (const [code, resp] of Object.entries(
      operation.responses as Record<string, Record<string, unknown>>
    )) {
      const respEntry: { description: string; schema?: Record<string, unknown> } = {
        description: (resp.description as string) || "",
      };
      if (
        (code === "200" || code === "201") &&
        resp.content
      ) {
        const respContent = resp.content as Record<
          string,
          { schema?: Record<string, unknown> }
        >;
        const jsonResp = respContent["application/json"];
        if (jsonResp?.schema) {
          respEntry.schema = simplifySchema(jsonResp.schema, 0);
        }
      }
      detail.responses[code] = respEntry;
    }
  }

  return detail;
}

export function writeDetailFile(detailsDir: string, detail: EndpointDetail): void {
  writeFileSync(
    join(detailsDir, `${detail.operationId}.json`),
    JSON.stringify(detail)
  );
}

/**
 * Drop detail files for operations no longer in the spec. Without this, an
 * endpoint Procore removed keeps serving its stale schema through
 * procore_get_endpoint_details long after it left the catalog.
 */
export function removeStaleDetailFiles(
  detailsDir: string,
  catalog: CatalogEntry[]
): void {
  const liveIds = new Set(catalog.map((e) => `${e.operationId}.json`));
  for (const file of readdirSync(detailsDir)) {
    if (file.endsWith(".json") && !liveIds.has(file)) {
      unlinkSync(join(detailsDir, file));
      console.log(`  removed stale detail file: ${file}`);
    }
  }
}
