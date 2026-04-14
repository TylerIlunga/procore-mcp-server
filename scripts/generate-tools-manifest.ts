/**
 * Generates a tools manifest from the catalog + endpoint details.
 * Each endpoint becomes a named tool with a clean name and simplified input schema.
 * Output: data/tools-manifest.json
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  ToolParam,
  summaryToToolName,
  truncateToolName,
  truncate,
  mapOasTypeToSimple,
  extractBodyParams,
  enrichParamDescription,
} from "./manifest-helpers.js";

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
  bodyWrapper?: string;
}

function buildManifestEntry(
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
    description: truncate(detail.description || entry.summary, 1024),
    category: entry.category,
    module: entry.module,
    version: entry.version,
    contentType: entry.contentType,
    params,
    bodyWrapper,
  };
}

function resolveCollisions(manifest: ToolManifestEntry[]): void {
  const nameToEntries = new Map<string, ToolManifestEntry[]>();
  for (const e of manifest) {
    if (!nameToEntries.has(e.toolName)) nameToEntries.set(e.toolName, []);
    nameToEntries.get(e.toolName)!.push(e);
  }

  for (const [name, entries] of nameToEntries) {
    if (entries.length <= 1) continue;

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      let newName = name;

      if (e.path.includes("/projects/{") && !name.includes("project")) {
        newName = name + "_project";
      } else if (e.path.includes("/companies/{") && !name.includes("company")) {
        newName = name + "_company";
      }

      if (
        newName === name ||
        entries.filter((x) => x.toolName === newName).length > 0
      ) {
        const vSuffix = e.version.replace(/\./g, "_");
        if (!newName.endsWith(vSuffix)) newName = newName + "_" + vSuffix;
      }

      const allNames = manifest.map((m) => m.toolName);
      if (allNames.filter((n) => n === newName).length > 1) {
        newName = newName + "_" + (i + 1);
      }

      e.toolName = truncateToolName(newName);
    }
  }

  // Final dedup pass
  const finalNames = new Map<string, number>();
  for (const entry of manifest) {
    const count = finalNames.get(entry.toolName) || 0;
    if (count > 0) {
      entry.toolName = truncateToolName(entry.toolName + "_" + (count + 1));
    }
    finalNames.set(entry.toolName, count + 1);
  }
}

function main() {
  console.log("Generating tools manifest...");

  const catalog = JSON.parse(
    readFileSync(join(DATA_DIR, "catalog.json"), "utf8")
  ) as CatalogEntry[];

  const manifest: ToolManifestEntry[] = [];

  for (const entry of catalog) {
    let detail: EndpointDetail;
    try {
      detail = JSON.parse(
        readFileSync(join(DETAILS_DIR, `${entry.operationId}.json`), "utf8")
      );
    } catch {
      continue;
    }
    manifest.push(buildManifestEntry(entry, detail));
  }

  resolveCollisions(manifest);

  writeFileSync(
    join(DATA_DIR, "tools-manifest.json"),
    JSON.stringify(manifest, null, 0)
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

  console.log(`\nSample tools:`);
  const sampleNames = [
    "create_rfi", "list_projects", "list_rfis",
    "create_project", "create_punch_item", "list_submittals",
  ];
  for (const s of manifest.filter((e) => sampleNames.includes(e.toolName)).slice(0, 6)) {
    console.log(`  ${s.toolName} → ${s.method} ${s.path} (${s.params.length} params)`);
  }
}

main();
