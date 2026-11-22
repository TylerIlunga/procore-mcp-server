/**
 * Generates the endpoint catalog from the Procore OAS.
 * Output: data/catalog.json, data/categories.json, data/endpoint-details/*.json
 *
 * The rules live in scripts/catalog/: collection detection (collection.ts),
 * typo repair (typo-fixes.ts), parameter and request-body extraction
 * (operation-params.ts), schema simplification (simplify-schema.ts), detail
 * files and stale-file cleanup (detail-files.ts), and the category index
 * (category-index.ts).
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { truncate } from "./shared/truncate.js";
import { fixTypos } from "./catalog/typo-fixes.js";
import { detectReturnsCollection } from "./catalog/collection.js";
import {
  extractVersion,
  parseTag,
  collectParams,
  hasPaginationParams,
  requestBodyOf,
} from "./catalog/operation-params.js";
import {
  buildEndpointDetail,
  writeDetailFile,
  removeStaleDetailFiles,
} from "./catalog/detail-files.js";
import {
  addToCategoryIndex,
  printCatalogStats,
  type CategoryMap,
} from "./catalog/category-index.js";
import {
  HTTP_METHODS,
  type CatalogEntry,
  type CategoryIndex,
  type OASOperation,
  type OASParameter,
} from "./catalog/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OAS_PATH = join(ROOT, "specs", "combined_OAS.json");
const DATA_DIR = join(ROOT, "data");
const DETAILS_DIR = join(DATA_DIR, "endpoint-details");

function main() {
  console.log("Loading OAS file...");
  const oas = JSON.parse(readFileSync(OAS_PATH, "utf8"));
  const paths = oas.paths as Record<string, Record<string, unknown>>;

  console.log(`Found ${Object.keys(paths).length} paths`);

  // Ensure output dirs exist
  mkdirSync(DETAILS_DIR, { recursive: true });

  const catalog: CatalogEntry[] = [];
  const categoryMap: CategoryMap = {};
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

      const dedupedParams = collectParams(sharedParams, operation);
      const pathParams = dedupedParams
        .filter((p) => p.in === "path")
        .map((p) => p.name);
      const requiredParams = dedupedParams
        .filter((p) => p.required)
        .map((p) => p.name);

      const body = requestBodyOf(operation);

      // Build catalog entry
      const collection = detectReturnsCollection(
        operation,
        method,
        path,
        hasPaginationParams(dedupedParams)
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
        hasRequestBody: body.hasRequestBody,
        contentType: body.contentType,
        returnsCollection: collection.returnsCollection,
        collectionEnvelope: collection.collectionEnvelope,
        deprecated: operation.deprecated === true,
        deprecatedAt: operation["x-deprecated-at"],
        sunset: operation["x-sunset"],
      };
      catalog.push(entry);

      addToCategoryIndex(categoryMap, category, module, tag);

      writeDetailFile(
        DETAILS_DIR,
        buildEndpointDetail(operation, method, path, tag, dedupedParams, body)
      );
    }
  }

  removeStaleDetailFiles(DETAILS_DIR, catalog);

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

  printCatalogStats(catalog, categoryMap, operationCount);
}

main();
