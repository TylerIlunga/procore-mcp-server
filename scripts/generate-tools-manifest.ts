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
  dedupeParams,
  withSuffix,
  collapseStutter,
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
  returnsCollection: boolean;
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
  returnsCollection: boolean;
  collectionEnvelope?: string;
  deprecated: boolean;
  deprecatedAt?: string;
  sunset?: string;
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
function isNonCallable(entry: CatalogEntry): boolean {
  return entry.path.startsWith("/oauth");
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

/** "project" / "company" / "root" — the scope a path is nested under. */
function scopeOf(path: string): string {
  if (path.includes("/projects/{")) return "project";
  if (path.includes("/companies/{")) return "company";
  return "root";
}

/**
 * The literal path segment that separates this entry from its identically
 * named peers — e.g. the five "Check PDF generation status" endpoints differ
 * only by parent resource (prime_change_orders, commitment_contracts, ...).
 * A named suffix beats the opaque `_2`/`_4` numbering it replaces.
 */
function distinguishingSegment(
  e: ToolManifestEntry,
  peers: ToolManifestEntry[]
): string | null {
  const tokenize = (p: string) =>
    p
      .replace(/\/rest\/v[\d.]+\//, "/")
      .split("/")
      .filter((s) => s && !s.startsWith("{") && s !== "companies" && s !== "projects");
  const mine = tokenize(e.path);
  const others = new Set(
    peers.filter((x) => x !== e).flatMap((x) => tokenize(x.path))
  );
  const distinct = mine.filter((s) => !others.has(s));
  if (distinct.length === 0) return null;
  // Prefer the most specific (last) segment that isn't already part of the
  // name — `list_accepted_weather_conditions` should gain `_daily_logs`, not
  // a redundant `_weather_conditions`.
  const fresh = distinct.filter((s) => !e.toolName.includes(s.toLowerCase()));
  const pick = (fresh.length > 0 ? fresh : distinct).pop()!;
  return pick.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

/** Rename the still-colliding members of a family with one disambiguator. */
function applyStage(
  entries: ToolManifestEntry[],
  rename: (e: ToolManifestEntry, peers: ToolManifestEntry[]) => string | null
): void {
  const byName = new Map<string, ToolManifestEntry[]>();
  for (const e of entries) {
    const bucket = byName.get(e.toolName);
    if (bucket) bucket.push(e);
    else byName.set(e.toolName, [e]);
  }
  for (const group of byName.values()) {
    if (group.length <= 1) continue;
    for (const e of group) {
      const next = rename(e, group);
      if (next) e.toolName = next;
    }
  }
}

/**
 * Disambiguate identically named tools with meaning-bearing suffixes, in
 * order of how much signal each carries: scope (company vs project), API
 * version (only when peers actually differ on it), then the path segment
 * that tells the endpoints apart. Numbers are the last resort — an agent can
 * choose between `..._prime_change_orders` and `..._commitment_contracts`,
 * but not between `_2` and `_4`.
 */
function resolveCollisions(manifest: ToolManifestEntry[]): void {
  const nameToEntries = new Map<string, ToolManifestEntry[]>();
  for (const e of manifest) {
    if (!nameToEntries.has(e.toolName)) nameToEntries.set(e.toolName, []);
    nameToEntries.get(e.toolName)!.push(e);
  }

  for (const [name, entries] of nameToEntries) {
    if (entries.length <= 1) continue;

    // Stage 1: company/project scope, only when the family actually spans
    // scopes — a suffix every member shares distinguishes nothing.
    if (new Set(entries.map((e) => scopeOf(e.path))).size > 1) {
      for (const e of entries) {
        const scope = scopeOf(e.path);
        if (scope !== "root" && !name.includes(scope)) {
          e.toolName = withSuffix(name, scope);
        }
      }
    }

    // Stage 2: API version, only where the colliding peers differ on it.
    applyStage(entries, (e, peers) => {
      if (new Set(peers.map((p) => p.version)).size <= 1) return null;
      const vSuffix = e.version.replace(/\./g, "_");
      return e.toolName.endsWith(vSuffix) ? null : withSuffix(e.toolName, vSuffix);
    });

    // Stage 3: the path segment that separates this entry from its peers.
    applyStage(entries, (e, peers) => {
      const segment = distinguishingSegment(e, peers);
      return segment ? collapseStutter(withSuffix(e.toolName, segment)) : null;
    });

    // Stage 4: HTTP method, for PATCH/PUT twins on the same path.
    applyStage(entries, (e, peers) => {
      if (new Set(peers.map((p) => p.method)).size <= 1) return null;
      return withSuffix(e.toolName, e.method.toLowerCase());
    });
  }

  // Final pass: guarantee uniqueness. Distinct endpoints can still collapse to
  // the same name when their summaries match and every structural suffix is
  // already taken, so keep numbering until the name is genuinely free.
  const taken = new Set<string>();
  for (const entry of manifest) {
    if (!taken.has(entry.toolName)) {
      taken.add(entry.toolName);
      continue;
    }
    let n = 2;
    let candidate = withSuffix(entry.toolName, String(n));
    while (taken.has(candidate)) {
      n++;
      candidate = withSuffix(entry.toolName, String(n));
    }
    entry.toolName = candidate;
    taken.add(candidate);
  }
}

function main() {
  console.log("Generating tools manifest...");

  const catalog = JSON.parse(
    readFileSync(join(DATA_DIR, "catalog.json"), "utf8")
  ) as CatalogEntry[];

  let manifest: ToolManifestEntry[] = [];
  let skippedNonCallable = 0;

  for (const entry of catalog) {
    if (isNonCallable(entry)) {
      skippedNonCallable++;
      continue;
    }
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
  console.log(
    `Skipped ${skippedNonCallable} non-callable endpoint(s); still reachable via procore_api_call.`
  );
  console.log(
    `Deprecated tools carrying a sunset notice: ${manifest.filter((e) => e.deprecated).length}`
  );
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
