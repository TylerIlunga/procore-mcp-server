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

/** Replace `/rest/vX.Y/` with `/rest/vX/` so different versions of the same
 *  endpoint hash to the same key. */
function normalizeVersionInPath(path: string): string {
  return path.replace(/\/rest\/v\d+(?:\.\d+)?\//, "/rest/vX/");
}

function compareVersions(a: string, b: string): number {
  const pa = /v(\d+)\.(\d+)/.exec(a);
  const pb = /v(\d+)\.(\d+)/.exec(b);
  const [aMaj, aMin] = pa ? [parseInt(pa[1], 10), parseInt(pa[2], 10)] : [0, 0];
  const [bMaj, bMin] = pb ? [parseInt(pb[1], 10), parseInt(pb[2], 10)] : [0, 0];
  if (aMaj !== bMaj) return aMaj - bMaj;
  return aMin - bMin;
}

/**
 * Drop deprecated older-version duplicates of the same endpoint. Two entries
 * are duplicates when they share an HTTP method and produce the same path
 * after stripping the API version segment. Only one survives — the highest
 * version. Distinct paths under different versions are preserved.
 *
 * Removed endpoints are still reachable via `procore_api_call`; they just
 * stop being individual MCP tools to keep the surface coherent.
 */
function dedupeByVersionedPath(manifest: ToolManifestEntry[]): ToolManifestEntry[] {
  const groups = new Map<string, ToolManifestEntry[]>();
  for (const e of manifest) {
    const key = `${e.method} ${normalizeVersionInPath(e.path)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }

  const kept: ToolManifestEntry[] = [];
  let dropped = 0;
  for (const entries of groups.values()) {
    if (entries.length === 1) {
      kept.push(entries[0]);
      continue;
    }
    const sorted = [...entries].sort((a, b) => compareVersions(b.version, a.version));
    kept.push(sorted[0]);
    dropped += entries.length - 1;
  }

  if (dropped > 0) {
    console.log(`Deduplicated: dropped ${dropped} older-version duplicate(s).`);
  }
  return kept;
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

  let manifest: ToolManifestEntry[] = [];

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

  // Drop older-version duplicates of the same endpoint, then regenerate
  // names without their version suffix so the surviving v1.3 of e.g.
  // create_company_user becomes plain `create_company_user`. resolveCollisions
  // will reapply suffixes only where the deduped set still has overlaps.
  manifest = dedupeByVersionedPath(manifest);
  for (const e of manifest) {
    e.toolName = summaryToToolName(e.summary, e.method, e.path, "v1.0");
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
