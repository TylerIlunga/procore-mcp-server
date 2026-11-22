/**
 * Generates a tools manifest from the catalog + endpoint details.
 * Each endpoint becomes a named tool with a clean name and simplified input schema.
 * Output: data/tools-manifest.json, data/tool-renames.json
 *
 * The stages live in scripts/manifest/: entry building (build-entry.ts),
 * naming (naming.ts), params (params.ts, param-enrichment.ts), version dedup
 * (version-dedupe.ts), collision resolution (collisions.ts), cross-version
 * siblings (version-siblings.ts), and the spec-error description clearing
 * (description-clearing.ts).
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { CatalogEntry, EndpointDetail } from "./catalog/types.js";
import { buildManifestEntry, isNonCallable } from "./manifest/build-entry.js";
import { summaryToToolName } from "./manifest/naming.js";
import { dedupeByVersionedPath } from "./manifest/version-dedupe.js";
import { resolveCollisions } from "./manifest/collisions.js";
import { attachVersionSiblings } from "./manifest/version-siblings.js";
import {
  clearMisappliedDescriptions,
  clearGetDescribedAsCreate,
} from "./manifest/description-clearing.js";
import { printManifestStats } from "./manifest/report.js";
import type { ToolManifestEntry } from "./manifest/types.js";
import { normalizeToolVerb } from "./normalize-verbs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const DETAILS_DIR = join(DATA_DIR, "endpoint-details");

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

  // Collapse the leading verb onto a consistent verb_noun convention before
  // collisions are resolved, so any new overlap the renaming creates is
  // disambiguated by the same meaning-bearing stages as any other.
  const preVerbNames = manifest.map((e) => e.toolName);
  for (const e of manifest) {
    e.toolName = normalizeToolVerb(e);
  }

  resolveCollisions(manifest);
  attachVersionSiblings(manifest);
  clearMisappliedDescriptions(manifest);
  clearGetDescribedAsCreate(manifest);

  // Migration aid: old name -> current name, for anyone with saved prompts
  // or configs referencing the pre-normalization surface. Indices stay
  // aligned because resolveCollisions renames in place without reordering.
  const renames: Record<string, string> = {};
  manifest.forEach((e, i) => {
    if (preVerbNames[i] !== e.toolName) renames[preVerbNames[i]] = e.toolName;
  });
  writeFileSync(
    join(DATA_DIR, "tool-renames.json"),
    JSON.stringify(renames, null, 2)
  );
  console.log(`Verb normalization renamed ${Object.keys(renames).length} tool(s); map written to data/tool-renames.json.`);

  writeFileSync(
    join(DATA_DIR, "tools-manifest.json"),
    JSON.stringify(manifest, null, 0)
  );

  printManifestStats(manifest, skippedNonCallable);
}

main();
