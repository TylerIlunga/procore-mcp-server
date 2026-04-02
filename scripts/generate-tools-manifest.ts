/**
 * Generates a tools manifest from the catalog + endpoint details.
 * Each endpoint becomes a named tool with a clean name and simplified input schema.
 * Output: data/tools-manifest.json
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const DETAILS_DIR = join(DATA_DIR, "endpoint-details");

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
}

interface EndpointDetail {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  tag: string;
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
}

interface ToolParam {
  name: string;
  type: string; // "string" | "number" | "boolean" | "array" | "object"
  required: boolean;
  description: string;
  enum?: unknown[];
  source: "path" | "query" | "body";
}

interface ToolManifestEntry {
  toolName: string;
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  category: string;
  module: string;
  version: string;
  contentType: string | null;
  params: ToolParam[];
  bodyWrapper?: string; // e.g., "rfi" for {rfi: {...}}
}

const MAX_TOOL_NAME_LENGTH = 64;

// Convert OAS summary to a clean snake_case tool name
function summaryToToolName(
  summary: string,
  method: string,
  path: string,
  version: string
): string {
  let name = summary
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "");

  // If summary is empty or too generic, derive from path
  if (!name || name.length < 3) {
    const segments = path
      .replace(/\/rest\/v[\d.]+\//, "")
      .replace(/\{[^}]+\}/g, "")
      .replace(/\//g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    const methodPrefix =
      method === "GET"
        ? "get"
        : method === "POST"
          ? "create"
          : method === "PATCH"
            ? "update"
            : method === "DELETE"
              ? "delete"
              : method.toLowerCase();
    name = `${methodPrefix}_${segments}`;
  }

  // Append version suffix for non-v1.0 endpoints
  if (version !== "v1.0" && version !== "unknown") {
    const vSuffix = version.replace(/\./g, "_");
    name = `${name}_${vSuffix}`;
  }

  return truncateToolName(name);
}

// Truncate tool name to MAX_TOOL_NAME_LENGTH, cutting at word boundary
function truncateToolName(name: string): string {
  if (name.length <= MAX_TOOL_NAME_LENGTH) return name;
  // Cut at last underscore before the limit
  const truncated = name.slice(0, MAX_TOOL_NAME_LENGTH);
  const lastUnderscore = truncated.lastIndexOf("_");
  if (lastUnderscore > MAX_TOOL_NAME_LENGTH / 2) {
    return truncated.slice(0, lastUnderscore);
  }
  return truncated;
}

function mapOasTypeToSimple(schema: Record<string, unknown>): string {
  const type = schema.type as string;
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") return "array";
  if (type === "object") return "object";
  return "string";
}

function extractBodyParams(
  schema: Record<string, unknown>
): { params: ToolParam[]; wrapper?: string } {
  const params: ToolParam[] = [];
  let wrapper: string | undefined;

  if (!schema.properties) return { params };

  const props = schema.properties as Record<string, Record<string, unknown>>;
  const requiredFields = (schema.required as string[]) || [];
  const topKeys = Object.keys(props);

  // Detect wrapper pattern: single top-level key that's an object (e.g., {rfi: {...}})
  if (topKeys.length === 1) {
    const wrapperKey = topKeys[0];
    const wrapperSchema = props[wrapperKey];
    if (
      wrapperSchema.type === "object" &&
      wrapperSchema.properties
    ) {
      wrapper = wrapperKey;
      const innerProps = wrapperSchema.properties as Record<
        string,
        Record<string, unknown>
      >;
      const innerRequired = (wrapperSchema.required as string[]) || [];

      for (const [name, propSchema] of Object.entries(innerProps)) {
        params.push({
          name,
          type: mapOasTypeToSimple(propSchema),
          required: innerRequired.includes(name),
          description: truncate(
            (propSchema.description as string) || name,
            200
          ),
          enum: propSchema.enum as unknown[] | undefined,
          source: "body",
        });
      }
      return { params, wrapper };
    }
  }

  // No wrapper — flatten all top-level properties
  for (const [name, propSchema] of Object.entries(props)) {
    params.push({
      name,
      type: mapOasTypeToSimple(propSchema),
      required: requiredFields.includes(name),
      description: truncate(
        (propSchema.description as string) || name,
        200
      ),
      enum: propSchema.enum as unknown[] | undefined,
      source: "body",
    });
  }

  return { params };
}

function truncate(str: string, max: number): string {
  if (!str || str.length <= max) return str || "";
  return str.slice(0, max - 3) + "...";
}

function main() {
  console.log("Generating tools manifest...");

  const catalog = JSON.parse(
    readFileSync(join(DATA_DIR, "catalog.json"), "utf8")
  ) as CatalogEntry[];

  const manifest: ToolManifestEntry[] = [];
  const nameCounters = new Map<string, number>();
  const nameToEntries = new Map<string, ToolManifestEntry[]>();

  for (const entry of catalog) {
    // Include multipart endpoints — they accept JSON bodies for non-file fields

    // Read endpoint detail
    let detail: EndpointDetail;
    try {
      detail = JSON.parse(
        readFileSync(
          join(DETAILS_DIR, `${entry.operationId}.json`),
          "utf8"
        )
      );
    } catch {
      continue;
    }

    // Generate tool name
    let toolName = summaryToToolName(
      entry.summary,
      entry.method,
      entry.path,
      entry.version
    );

    // Build params from endpoint detail
    const params: ToolParam[] = [];

    // Path and query params (excluding Procore-Company-Id)
    for (const p of detail.parameters) {
      if (p.name === "Procore-Company-Id" && p.in === "header") continue;
      params.push({
        name: p.name,
        type: mapOasTypeToSimple(p.schema || {}),
        required: p.required,
        description: truncate(p.description || p.name, 200),
        enum: p.schema?.enum as unknown[] | undefined,
        source: p.in as "path" | "query",
      });
    }

    // Body params
    let bodyWrapper: string | undefined;
    if (detail.requestBody?.schema) {
      const { params: bodyParams, wrapper } = extractBodyParams(
        detail.requestBody.schema
      );
      bodyWrapper = wrapper;
      params.push(...bodyParams);
    }

    const manifestEntry: ToolManifestEntry = {
      toolName,
      operationId: entry.operationId,
      method: entry.method,
      path: entry.path,
      summary: entry.summary,
      description: truncate(detail.description || entry.summary, 300),
      category: entry.category,
      module: entry.module,
      version: entry.version,
      contentType: entry.contentType,
      params,
      bodyWrapper,
    };

    // Track for collision resolution
    if (!nameToEntries.has(toolName)) {
      nameToEntries.set(toolName, []);
    }
    nameToEntries.get(toolName)!.push(manifestEntry);
    manifest.push(manifestEntry);
  }

  // Resolve naming collisions
  for (const [name, entries] of nameToEntries) {
    if (entries.length <= 1) continue;

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      // Try appending scope (company vs project)
      const hasProject = e.path.includes("/projects/{");
      const hasCompany = e.path.includes("/companies/{");

      let newName = name;
      if (hasProject && !name.includes("project")) {
        newName = name + "_project";
      } else if (hasCompany && !name.includes("company")) {
        newName = name + "_company";
      }

      // If still colliding, append version
      if (newName === name || entries.filter((x) => x.toolName === newName).length > 0) {
        const vSuffix = e.version.replace(/\./g, "_");
        if (!newName.endsWith(vSuffix)) {
          newName = newName + "_" + vSuffix;
        }
      }

      // Last resort: append index
      const allNames = manifest.map((m) => m.toolName);
      if (allNames.filter((n) => n === newName).length > 1) {
        newName = newName + "_" + (i + 1);
      }

      e.toolName = truncateToolName(newName);
    }
  }

  // Final dedup pass — catch any remaining collisions
  const finalNames = new Map<string, number>();
  for (const entry of manifest) {
    const count = finalNames.get(entry.toolName) || 0;
    if (count > 0) {
      entry.toolName = truncateToolName(entry.toolName + "_" + (count + 1));
    }
    finalNames.set(entry.toolName, count + 1);
  }

  // Write manifest
  writeFileSync(
    join(DATA_DIR, "tools-manifest.json"),
    JSON.stringify(manifest, null, 0) // compact for smaller file
  );

  // Stats
  const byCategory = new Map<string, number>();
  for (const e of manifest) {
    byCategory.set(e.category, (byCategory.get(e.category) || 0) + 1);
  }

  console.log(`\nManifest generated: ${manifest.length} tools`);
  console.log(`\nBy category:`);
  for (const [cat, count] of [...byCategory.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${cat}: ${count} tools`);
  }

  // Check for remaining collisions
  const nameSet = new Set<string>();
  let collisions = 0;
  for (const e of manifest) {
    if (nameSet.has(e.toolName)) {
      collisions++;
      console.error(`COLLISION: ${e.toolName}`);
    }
    nameSet.add(e.toolName);
  }
  console.log(`\nCollisions: ${collisions}`);

  // Show sample tools
  console.log(`\nSample tools:`);
  const samples = manifest.filter((e) =>
    ["create_rfi", "list_projects", "list_rfis", "create_project", "create_punch_item", "list_submittals"].includes(e.toolName)
  );
  for (const s of samples.slice(0, 6)) {
    console.log(`  ${s.toolName} → ${s.method} ${s.path} (${s.params.length} params)`);
  }
}

main();
