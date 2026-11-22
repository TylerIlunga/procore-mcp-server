/**
 * The category -> module -> tag index written to data/categories.json, and
 * the generation summary printed from it.
 */
import type { CatalogEntry, CategoryIndex } from "./types.js";

export type CategoryMap = CategoryIndex["categories"];

export function addToCategoryIndex(
  categoryMap: CategoryMap,
  category: string,
  module: string,
  tag: string
): void {
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
}

export function printCatalogStats(
  catalog: CatalogEntry[],
  categoryMap: CategoryMap,
  operationCount: number
): void {
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
