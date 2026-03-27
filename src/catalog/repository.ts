import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { CatalogEntry, CategoryIndex, EndpointDetail } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// When compiled: dist/src/catalog/ → need ../../../data to reach project root
const DATA_DIR = join(__dirname, "..", "..", "..", "data");

let catalogCache: CatalogEntry[] | null = null;
let categoriesCache: CategoryIndex | null = null;

export function loadCatalog(): CatalogEntry[] {
  if (catalogCache) return catalogCache;
  const raw = readFileSync(join(DATA_DIR, "catalog.json"), "utf8");
  catalogCache = JSON.parse(raw) as CatalogEntry[];
  return catalogCache;
}

export function loadCategories(): CategoryIndex {
  if (categoriesCache) return categoriesCache;
  const raw = readFileSync(join(DATA_DIR, "categories.json"), "utf8");
  categoriesCache = JSON.parse(raw) as CategoryIndex;
  return categoriesCache;
}

export function loadEndpointDetail(
  operationId: string
): EndpointDetail | null {
  try {
    const raw = readFileSync(
      join(DATA_DIR, "endpoint-details", `${operationId}.json`),
      "utf8"
    );
    return JSON.parse(raw) as EndpointDetail;
  } catch {
    return null;
  }
}

export function findByOperationId(
  operationId: string
): CatalogEntry | undefined {
  const catalog = loadCatalog();
  return catalog.find((e) => e.operationId === operationId);
}
