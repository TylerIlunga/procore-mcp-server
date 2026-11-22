import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "fs";
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

    // A schema with exactly one property is drawn purely to wrap that
    // property — Procore's older v1.0 endpoints envelope under the plural
    // resource name (`{ exchange_rates: [...] }`) rather than a generic
    // `data`/`items` key, which the fixed allowlist above can't anticipate.
    const propNames = Object.keys(props);
    if (propNames.length === 1) {
      const inner = schemaIsCollection(props[propNames[0]], depth + 1);
      if (inner?.kind === "collection") {
        return { kind: "collection", envelope: propNames[0] };
      }
    }
    return { kind: "single" };
  }

  // allOf composes by intersection -- the real response is the MERGE of every
  // branch's properties, not "does any branch match" (that's what oneOf/anyOf
  // mean). Treating them the same let one branch's incidental extra field
  // decide the shape of the whole merged object: a TimecardEntry response
  // allOf'd with `{ automatically_split_timecard_entries: [...] }` (an
  // optional extra, only present under overtime management) is still a
  // single TimecardEntry, not a list, once every branch's fields are merged.
  const allOfBranches = schema.allOf as Record<string, unknown>[] | undefined;
  if (Array.isArray(allOfBranches)) {
    const merged: Record<string, unknown> = {};
    let anyBareArray = false;
    for (const branch of allOfBranches) {
      if (branch.type === "array") anyBareArray = true;
      else if (branch.type === "object" && branch.properties) {
        Object.assign(merged, branch.properties as Record<string, unknown>);
      }
    }
    if (anyBareArray) return { kind: "collection" };
    return schemaIsCollection({ type: "object", properties: merged }, depth + 1);
  }

  // oneOf/anyOf describe genuine alternation, so any branch drawn as a
  // collection means the response can genuinely be one.
  for (const key of ["oneOf", "anyOf"] as const) {
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

/**
 * Explicit collection language inside the operation's prose description, for
 * endpoints whose *summary* is terse ("Get Layers") but whose description
 * spells out the plural intent ("Returns all accessible layers ..."). Unlike
 * LIST_SUMMARY this only needs to match anywhere near the start of the
 * description, not anchor the whole string.
 */
const LIST_DESCRIPTION =
  /\b(returns?|retrieves?|gets?|lists?|shows?)\s+(all|the collection of|a collection of|the full (?:list|set) of|a (?:full )?list of)\b/i;

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
  // Prefer application/json, but Procore occasionally documents a response
  // only under a wildcard content type (`*/*`) — falling through to
  // `undefined` there discarded a real (if uninformative) schema and forced
  // every such endpoint through the no-schema path below.
  const content = ok?.content;
  const schema =
    content?.["application/json"]?.schema ??
    (content ? Object.values(content)[0]?.schema : undefined);

  // A scalar or binary payload (a raw CSV/PDF/file download, `type: "string",
  // format: "binary"`) can never be "a JSON array of records", no matter what
  // pagination params or list language the operation declares -- those are
  // often just copied from a sibling JSON-list endpoint's parameter template.
  // This is unconditional, unlike the softer `single` verdict below.
  const scalarTypes = new Set(["string", "number", "integer", "boolean"]);
  if (schema && typeof schema.type === "string" && scalarTypes.has(schema.type)) {
    return { returnsCollection: false };
  }

  const verdict = schemaIsCollection(schema);
  if (verdict?.kind === "collection") {
    return { returnsCollection: true, collectionEnvelope: verdict.envelope };
  }

  const description = operation.description || "";
  const textSignalsList =
    LIST_SUMMARY.test(operation.summary || "") ||
    LIST_DESCRIPTION.test(description.slice(0, 200));
  const collectionPath = pathEndsInCollection(path);
  /**
   * On a non-{id} path (`.../purchase_orders/{id}/related_documents`), the
   * trailing segment already names a real sub-collection, so declared
   * pagination alone is trustworthy -- either signal suffices. On an
   * {id}-shaped path, that same trust is exactly what produced two false
   * positives (show_company_vendor, show_recycled_checklist_template):
   * Procore's spec sometimes copies page/per_page onto a genuine
   * show-by-id endpoint with no textual list signal behind it. So there,
   * pagination is corroborating evidence, not sufficient on its own -- it
   * must be paired with explicit list language (which is what makes
   * accessible_layers/{context_type_id} correctly read as a collection: its
   * trailing segment looks like an id but is actually a filter, and its own
   * description says "Retrieve all layers ...").
   */
  const overridesDefiniteSingle = collectionPath
    ? hasPagination || textSignalsList
    : hasPagination && textSignalsList;

  if (verdict?.kind === "ambiguous-envelope") {
    // The spec draws one enveloped element, but v2 list endpoints are often
    // documented that way.
    return overridesDefiniteSingle
      ? { returnsCollection: true, collectionEnvelope: verdict.envelope }
      : { returnsCollection: false };
  }
  if (verdict?.kind === "single") {
    // A definite object schema usually means a genuine singleton — but
    // Procore sometimes documents only the array *item's* shape (a "Show All
    // ..." endpoint whose schema is one Batch object, not an array of them).
    // Only the strongest signals overturn it, to avoid reintroducing
    // pagination on truly-singleton endpoints.
    return { returnsCollection: overridesDefiniteSingle };
  }

  // No usable schema at all -- the weakest-evidence case. Trust the same
  // signal combination as above.
  return { returnsCollection: overridesDefiniteSingle };
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
  // A bare HTTP-method word leading the summary ("POST Company Role") is an
  // OAS authoring shortcut, not a natural-language title -- it produced tool
  // names like post_company_role/patch_company_role that read as raw HTTP
  // verbs instead of an action. GET/DELETE are already natural verbs, so
  // those two rules are pure casing normalization.
  [/^POST\s+/, "Create "],
  [/^PATCH\s+/, "Update "],
  [/^PUT\s+/, "Update "],
  [/^GET\s+/, "Get "],
  [/^DELETE\s+/, "Delete "],
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
        // 1600 comfortably fits all but a handful of Procore's longest
        // operation descriptions (file-format tables, mainly) without
        // truncation; the ones still cut fall back to trimToWholeSentence.
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

      // Write detail file
      writeFileSync(
        join(DETAILS_DIR, `${operation.operationId}.json`),
        JSON.stringify(detail)
      );
    }
  }

  // Drop detail files for operations no longer in the spec. Without this, an
  // endpoint Procore removed keeps serving its stale schema through
  // procore_get_endpoint_details long after it left the catalog.
  const liveIds = new Set(catalog.map((e) => `${e.operationId}.json`));
  for (const file of readdirSync(DETAILS_DIR)) {
    if (file.endsWith(".json") && !liveIds.has(file)) {
      unlinkSync(join(DETAILS_DIR, file));
      console.log(`  removed stale detail file: ${file}`);
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
