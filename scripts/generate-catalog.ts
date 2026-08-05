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

/**
 * Decide whether a 2xx response body is a collection. Unwraps allOf/oneOf/anyOf
 * so wrapper schemas don't hide an array. Returns null when the spec gives no
 * usable signal, in which case the caller falls back to path/summary shape.
 */
function schemaIsCollection(
  schema: Record<string, unknown> | undefined,
  depth = 0
): boolean | null {
  if (!schema || depth > 4) return null;
  if (schema.type === "array") return true;
  if (schema.type === "object") return false;

  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const branches = schema[key] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(branches)) continue;
    let sawObject = false;
    for (const branch of branches) {
      const verdict = schemaIsCollection(branch, depth + 1);
      if (verdict === true) return true;
      if (verdict === false) sawObject = true;
    }
    if (sawObject) return false;
  }
  return null;
}

/** Path ends in a literal segment (a collection) rather than an `{id}`. */
function pathEndsInCollection(path: string): boolean {
  const last = path.split("/").filter(Boolean).pop() || "";
  return !last.startsWith("{");
}

const LIST_SUMMARY = /^(list|index|get all|retrieve all|show all|return a list|returns a list|get a list)\b/i;

function detectReturnsCollection(
  operation: OASOperation,
  method: string,
  path: string
): boolean {
  if (method !== "get") return false;

  const responses = (operation.responses || {}) as Record<
    string,
    { content?: Record<string, { schema?: Record<string, unknown> }> }
  >;
  const ok = responses["200"] || responses["201"];
  const schema = ok?.content?.["application/json"]?.schema;

  const verdict = schemaIsCollection(schema);
  if (verdict !== null) return verdict;

  // No usable schema. Trust an explicit "List ..." summary; otherwise assume a
  // single object. Guessing from path shape alone is what previously mislabelled
  // singleton config endpoints as paginated collections.
  if (!pathEndsInCollection(path)) return false;
  return LIST_SUMMARY.test(operation.summary || "");
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
      const entry: CatalogEntry = {
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: truncate(operation.summary || "", 200),
        tag,
        category,
        module,
        version,
        pathParams,
        requiredParams,
        hasRequestBody,
        contentType,
        returnsCollection: detectReturnsCollection(operation, method, path),
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
        summary: operation.summary || "",
        description: truncate(operation.description || "", 800),
        tag,
        deprecated: operation.deprecated === true,
        deprecatedAt: operation["x-deprecated-at"],
        sunset: operation["x-sunset"],
        parameters: dedupedParams.map((p) => ({
          name: p.name,
          in: p.in,
          required: p.required || false,
          description: truncate(p.description || "", 200),
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
