/**
 * Per-operation extraction from the OAS: API version, tag split, the merged
 * parameter list, and the request body's content type and schema.
 */
import type { OASOperation, OASParameter } from "./types.js";

export function extractVersion(path: string): string {
  const match = path.match(/\/rest\/(v[\d.]+)\//);
  return match ? match[1] : "unknown";
}

export function parseTag(tag: string): { category: string; module: string } {
  const parts = tag.split("/");
  return {
    category: parts[0] || "Other",
    module: parts[1] || parts[0] || "General",
  };
}

/** Path-level shared params plus the operation's own, minus the
 *  Procore-Company-Id header (the client sets it), deduplicated by name+in. */
export function collectParams(
  sharedParams: OASParameter[],
  operation: OASOperation
): OASParameter[] {
  // Merge shared + operation params, excluding Procore-Company-Id header
  const allParams = [
    ...sharedParams,
    ...(operation.parameters || []),
  ].filter(
    (p) =>
      !(p.name === "Procore-Company-Id" && p.in === "header")
  );

  // Deduplicate params by name+in
  const seen = new Set<string>();
  return allParams.filter((p) => {
    const key = `${p.name}:${p.in}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The endpoint accepts page/per_page — only collections are paginated. */
export function hasPaginationParams(params: OASParameter[]): boolean {
  return params.some(
    (p) => p.in === "query" && (p.name === "page" || p.name === "per_page")
  );
}

export interface RequestBodyShape {
  contentType: string | null;
  hasRequestBody: boolean;
  requestBodySchema: Record<string, unknown> | undefined;
}

/** Determine content type, preferring multipart/form-data when offered. */
export function requestBodyOf(operation: OASOperation): RequestBodyShape {
  let contentType: string | null = null;
  let hasRequestBody = false;
  let requestBodySchema: Record<string, unknown> | undefined;

  if (operation.requestBody?.content) {
    hasRequestBody = true;
    const contentTypes = Object.keys(operation.requestBody.content);
    contentType = contentTypes.includes("multipart/form-data")
      ? "multipart/form-data"
      : contentTypes[0] || "application/json";
    requestBodySchema =
      operation.requestBody.content[contentType]?.schema as
        | Record<string, unknown>
        | undefined;
  }

  return { contentType, hasRequestBody, requestBodySchema };
}
