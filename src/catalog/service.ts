import {
  loadCatalog,
  loadCategories,
  loadEndpointDetail,
  findByOperationId,
} from "./repository.js";
import type { CatalogEntry, CategoryIndex, EndpointDetail } from "./types.js";

export function getCategories(): CategoryIndex {
  return loadCategories();
}

export function discoverEndpoints(options: {
  category?: string;
  module?: string;
  search?: string;
  methodFilter?: string;
}): CatalogEntry[] {
  let entries = loadCatalog();

  if (options.category) {
    entries = entries.filter(
      (e) => e.category.toLowerCase() === options.category!.toLowerCase()
    );
  }

  if (options.module) {
    entries = entries.filter(
      (e) => e.module.toLowerCase() === options.module!.toLowerCase()
    );
  }

  if (options.methodFilter) {
    entries = entries.filter(
      (e) => e.method === options.methodFilter!.toUpperCase()
    );
  }

  if (options.search) {
    const terms = options.search.toLowerCase().split(/\s+/);
    entries = entries.filter((e) => {
      const text =
        `${e.summary} ${e.tag} ${e.path} ${e.operationId}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }

  return entries;
}

export function searchEndpoints(query: string): CatalogEntry[] {
  const catalog = loadCatalog();
  const terms = query.toLowerCase().split(/\s+/);

  // Score each entry
  const scored = catalog.map((entry) => {
    const summaryLower = entry.summary.toLowerCase();
    const tagLower = entry.tag.toLowerCase();
    const pathLower = entry.path.toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (summaryLower.includes(term)) score += 10;
      if (tagLower.includes(term)) score += 5;
      if (pathLower.includes(term)) score += 3;
    }

    // Boost exact matches
    if (summaryLower === query.toLowerCase()) score += 50;

    return { entry, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((s) => s.entry);
}

export function getEndpointDetails(
  operationId: string
): EndpointDetail | null {
  return loadEndpointDetail(operationId);
}

export function getEndpointByOperationId(
  operationId: string
): CatalogEntry | undefined {
  return findByOperationId(operationId);
}
