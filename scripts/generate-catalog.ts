import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OAS_PATH = join(ROOT, "specs", "combined_OAS.json");
const DATA_DIR = join(ROOT, "data");
const DETAILS_DIR = join(DATA_DIR, "endpoint-details");

interface OASParameter {
  name: string;
  in: string;
  description?: string;
  required?: boolean;
  schema?: Record<string, unknown>;
}

interface OASOperation {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  "x-deprecated-at"?: string;
  "x-sunset"?: string;
  parameters?: OASParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<string, unknown>;
}

interface CatalogEntry {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  tag: string;
  category: string;
  module: string;
  version: string;
  pathParams: string[];
  requiredParams: string[];
  hasRequestBody: boolean;
  contentType: string | null;
  /** True when the 2xx response is a JSON array (a collection), so callers
   *  know pagination applies. Derived from the response schema, not the path. */
  returnsCollection: boolean;
  /** Response property that wraps the collection array. Procore's v2.x
   *  endpoints envelope their payload as `{ data: [...] }`. */
  collectionEnvelope?: string;
  deprecated: boolean;
  deprecatedAt?: string;
  sunset?: string;
}

interface EndpointDetail {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  tag: string;
  deprecated: boolean;
  deprecatedAt?: string;
  sunset?: string;
  parameters: Array<{
    name: string;
    in: string;
    required: boolean;
    description: string;
    schema: Record<string, unknown>;
  }>;
  requestBody?: {
    contentType: string;
    required: boolean;
    schema: Record<string, unknown>;
  };
  responses: Record<string, { description: string; schema?: Record<string, unknown> }>;
}

interface CategoryIndex {
  categories: Record<
    string,
    {
      modules: Record<string, { endpointCount: number; tags: string[] }>;
      totalEndpoints: number;
    }
  >;
  totalEndpoints: number;
  generatedAt: string;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function extractVersion(path: string): string {
  const match = path.match(/\/rest\/(v[\d.]+)\//);
  return match ? match[1] : "unknown";
}

function parseTag(tag: string): { category: string; module: string } {
  const parts = tag.split("/");
  return {
    category: parts[0] || "Other",
    module: parts[1] || parts[0] || "General",
  };
}

function truncate(str: string, max: number): string {
  if (!str || str.length <= max) return str || "";
  return str.slice(0, max - 3) + "...";
}

function simplifySchema(
  schema: Record<string, unknown> | undefined,
  depth = 0
): Record<string, unknown> {
  if (!schema) return {};
  if (depth > 3) return { type: "object", description: "(nested object)" };

  const result: Record<string, unknown> = {};
  if (schema.type) result.type = schema.type;
  if (schema.description)
    result.description = truncate(schema.description as string, 200);
  if (schema.enum) {
    const enumVals = schema.enum as unknown[];
    if (enumVals.length <= 15) {
      result.enum = enumVals;
    } else {
      result.description =
        (result.description || "") + ` (${enumVals.length} possible values)`;
    }
  }
  if (schema.required) result.required = schema.required;
  if (schema.format) result.format = schema.format;
  if (schema.default !== undefined) result.default = schema.default;

  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(
      schema.properties as Record<string, Record<string, unknown>>
    )) {
      props[key] = simplifySchema(val, depth + 1);
    }
    result.properties = props;
  }

  if (schema.items) {
    result.items = simplifySchema(
      schema.items as Record<string, unknown>,
      depth + 1
    );
  }

  return result;
}

/** Response properties that conventionally wrap the real payload. */
const ENVELOPE_KEYS = ["data", "items", "results", "records", "entries"] as const;

type CollectionVerdict =
  | { kind: "collection"; envelope?: string }
  | { kind: "single" }
  /** An envelope whose element the spec draws as one object. Procore's v2
   *  specs routinely do this on genuine list endpoints, so the caller must
   *  weigh the summary before concluding "single". */
  | { kind: "ambiguous-envelope"; envelope: string }
  | null;

/**
 * Decide whether a 2xx response body is a collection. Unwraps allOf/oneOf/anyOf
 * and looks inside `{ data: ... }`-style envelopes so a wrapper object doesn't
 * hide an array. Returns null when the spec gives no usable signal, in which
 * case the caller falls back to path/summary shape.
 */
function schemaIsCollection(
  schema: Record<string, unknown> | undefined,
  depth = 0
): CollectionVerdict {
  if (!schema || depth > 4) return null;
  if (schema.type === "array") return { kind: "collection" };

  if (schema.type === "object") {
    const props = (schema.properties || {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const key of ENVELOPE_KEYS) {
      const child = props[key];
      if (!child) continue;
      const inner = schemaIsCollection(child, depth + 1);
      if (inner?.kind === "collection") {
        return { kind: "collection", envelope: key };
      }
      return { kind: "ambiguous-envelope", envelope: key };
    }
    return { kind: "single" };
  }

  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const branches = schema[key] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(branches)) continue;
    let fallback: CollectionVerdict = null;
    for (const branch of branches) {
      const verdict = schemaIsCollection(branch, depth + 1);
      if (verdict?.kind === "collection") return verdict;
      if (verdict && !fallback) fallback = verdict;
    }
    if (fallback) return fallback;
  }
  return null;
}

/** Path ends in a literal segment (a collection) rather than an `{id}`. */
function pathEndsInCollection(path: string): boolean {
  const last = path.split("/").filter(Boolean).pop() || "";
  return !last.startsWith("{");
}

const LIST_SUMMARY =
  /^(list|lists|index|search|get all|gets all|retrieve all|retrieves all|return all|returns all|show all|shows all|return a list|returns a list|get a list|gets a list|get the list)\b/i;

function detectReturnsCollection(
  operation: OASOperation,
  method: string,
  path: string,
  /** The endpoint accepts page/per_page — only collections are paginated. */
  hasPagination: boolean
): { returnsCollection: boolean; collectionEnvelope?: string } {
  if (method !== "get") return { returnsCollection: false };

  const responses = (operation.responses || {}) as Record<
    string,
    { content?: Record<string, { schema?: Record<string, unknown> }> }
  >;
  const ok = responses["200"] || responses["201"];
  const schema = ok?.content?.["application/json"]?.schema;

  const verdict = schemaIsCollection(schema);
  if (verdict?.kind === "collection") {
    return { returnsCollection: true, collectionEnvelope: verdict.envelope };
  }

  const summaryLooksList = LIST_SUMMARY.test(operation.summary || "");
  const collectionPath = pathEndsInCollection(path);

  if (verdict?.kind === "ambiguous-envelope") {
    // The spec draws one enveloped element, but v2 list endpoints are often
    // documented that way. Declared pagination settles it — a single record
    // is never paged — and an explicit list summary on a collection path is
    // the next strongest signal.
    return hasPagination || (summaryLooksList && collectionPath)
      ? { returnsCollection: true, collectionEnvelope: verdict.envelope }
      : { returnsCollection: false };
  }
  if (verdict?.kind === "single") return { returnsCollection: false };

  // No usable schema. Trust declared pagination, then an explicit "List ..."
  // summary; otherwise assume a single object. Guessing from path shape alone
  // is what previously mislabelled singleton config endpoints as paginated.
  if (!collectionPath) return { returnsCollection: false };
  return { returnsCollection: hasPagination || summaryLooksList };
}

/**
 * Spelling fixes for typos that ship in Procore's OAS prose. Tool names,
 * titles, and descriptions all derive from this text, so repair it at the
 * source. Each fix preserves a leading capital.
 */
const TYPO_FIXES: Array<[RegExp, string]> = [
  [/\basyncronous\b/gi, "asynchronous"],
  [/\bavailablility\b/gi, "availability"],
  [/\brecyled\b/gi, "recycled"],
  [/\bseperate\b/gi, "separate"],
  [/\boccured\b/gi, "occurred"],
  [/\bsucessfully\b/gi, "successfully"],
  [/\bdetete\b/gi, "delete"],
  [/\bupdats\b/gi, "updates"],
  [/\bassociat\b/gi, "associate"],
  // "Restored a deleted X" documents a restore endpoint in the past tense.
  [/^restored\b/i, "Restores"],
  // "Make a Tag from being Available to a Group" is a mangled negation of the
  // paired removal endpoint; the POST grants availability. Matches with or
  // without the article so the operation title is repaired too.
  [/\b(makes?)\s+((?:a|an)\s+)?(.+?)\s+from being available to\b/gi, "$1 $2$3 available to"],
];

function fixTypos(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [pattern, replacement] of TYPO_FIXES) {
    // A replacer function makes "$1" literal, so rewrites that reference
    // capture groups must use the plain string form.
    if (/\$\d/.test(replacement)) {
      out = out.replace(pattern, replacement);
      continue;
    }
    out = out.replace(pattern, (match) =>
      match[0] === match[0].toUpperCase()
        ? replacement[0].toUpperCase() + replacement.slice(1)
        : replacement
    );
  }
  return out;
}

function main() {
  console.log("Loading OAS file...");
  const oas = JSON.parse(readFileSync(OAS_PATH, "utf8"));
  const paths = oas.paths as Record<string, Record<string, unknown>>;

  console.log(`Found ${Object.keys(paths).length} paths`);

  // Ensure output dirs exist
  mkdirSync(DETAILS_DIR, { recursive: true });

  const catalog: CatalogEntry[] = [];
  const categoryMap: CategoryIndex["categories"] = {};
  let operationCount = 0;

  for (const [path, pathObj] of Object.entries(paths)) {
    const sharedParams = (pathObj.parameters || []) as OASParameter[];

    for (const method of HTTP_METHODS) {
      const operation = pathObj[method] as OASOperation | undefined;
      if (!operation) continue;

      operationCount++;
      const tag = operation.tags?.[0] || "Uncategorized";
      const { category, module } = parseTag(tag);
      const version = extractVersion(path);

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
      const dedupedParams = allParams.filter((p) => {
        const key = `${p.name}:${p.in}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const pathParams = dedupedParams
        .filter((p) => p.in === "path")
        .map((p) => p.name);
      const requiredParams = dedupedParams
        .filter((p) => p.required)
        .map((p) => p.name);

      // Determine content type
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

      // Build catalog entry
      const hasPagination = dedupedParams.some(
        (p) => p.in === "query" && (p.name === "page" || p.name === "per_page")
      );
      const collection = detectReturnsCollection(
        operation,
        method,
        path,
        hasPagination
      );
      const entry: CatalogEntry = {
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: truncate(fixTypos(operation.summary || ""), 200),
        tag,
        category,
        module,
        version,
        pathParams,
        requiredParams,
        hasRequestBody,
        contentType,
        returnsCollection: collection.returnsCollection,
        collectionEnvelope: collection.collectionEnvelope,
        deprecated: operation.deprecated === true,
        deprecatedAt: operation["x-deprecated-at"],
        sunset: operation["x-sunset"],
      };
      catalog.push(entry);

      // Build category index
      if (!categoryMap[category]) {
        categoryMap[category] = { modules: {}, totalEndpoints: 0 };
      }
      categoryMap[category].totalEndpoints++;
      if (!categoryMap[category].modules[module]) {
        categoryMap[category].modules[module] = {
          endpointCount: 0,
          tags: [],
        };
      }
      categoryMap[category].modules[module].endpointCount++;
      if (
        !categoryMap[category].modules[module].tags.includes(tag)
      ) {
        categoryMap[category].modules[module].tags.push(tag);
      }

      // Build endpoint detail file
      const detail: EndpointDetail = {
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: fixTypos(operation.summary || ""),
        description: truncate(fixTypos(operation.description || ""), 800),
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

      // Write detail file
      writeFileSync(
        join(DETAILS_DIR, `${operation.operationId}.json`),
        JSON.stringify(detail)
      );
    }
  }

  // Write catalog
  writeFileSync(
    join(DATA_DIR, "catalog.json"),
    JSON.stringify(catalog)
  );

  // Write categories index
  const categoryIndex: CategoryIndex = {
    categories: categoryMap,
    totalEndpoints: operationCount,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(DATA_DIR, "categories.json"),
    JSON.stringify(categoryIndex, null, 2)
  );

  // Print stats
  console.log(`\nGeneration complete:`);
  console.log(`  Operations: ${operationCount}`);
  console.log(`  Categories: ${Object.keys(categoryMap).length}`);
  console.log(
    `  Modules: ${Object.values(categoryMap).reduce(
      (sum, c) => sum + Object.keys(c.modules).length,
      0
    )}`
  );
  console.log(
    `  Catalog size: ${(
      Buffer.byteLength(JSON.stringify(catalog)) / 1024
    ).toFixed(0)} KB`
  );
  console.log(`  Detail files: ${operationCount}`);
  console.log(`  Deprecated: ${catalog.filter((e) => e.deprecated).length}`);
  console.log(
    `  Collection-returning GETs: ${catalog.filter((e) => e.returnsCollection).length}`
  );

  // Category breakdown
  console.log(`\nCategories:`);
  for (const [name, data] of Object.entries(categoryMap).sort(
    (a, b) => b[1].totalEndpoints - a[1].totalEndpoints
  )) {
    console.log(
      `  ${name}: ${data.totalEndpoints} endpoints, ${
        Object.keys(data.modules).length
      } modules`
    );
  }
}

main();
