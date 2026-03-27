import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

function main() {
  console.log("Validating catalog...");

  // Load catalog
  const catalogPath = join(DATA_DIR, "catalog.json");
  if (!existsSync(catalogPath)) {
    console.error("ERROR: catalog.json not found. Run npm run generate first.");
    process.exit(1);
  }

  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as Array<{
    operationId: string;
    method: string;
    path: string;
    category: string;
    module: string;
  }>;

  // Load categories
  const categoriesPath = join(DATA_DIR, "categories.json");
  if (!existsSync(categoriesPath)) {
    console.error("ERROR: categories.json not found.");
    process.exit(1);
  }

  const categories = JSON.parse(readFileSync(categoriesPath, "utf8"));

  let errors = 0;

  // Check each catalog entry has a detail file
  const operationIds = new Set<string>();
  for (const entry of catalog) {
    if (operationIds.has(entry.operationId)) {
      console.error(`DUPLICATE operationId: ${entry.operationId}`);
      errors++;
    }
    operationIds.add(entry.operationId);

    const detailPath = join(
      DATA_DIR,
      "endpoint-details",
      `${entry.operationId}.json`
    );
    if (!existsSync(detailPath)) {
      console.error(`MISSING detail file: ${entry.operationId}.json`);
      errors++;
    }

    // Validate required fields
    if (!entry.method) {
      console.error(`MISSING method for: ${entry.operationId}`);
      errors++;
    }
    if (!entry.path) {
      console.error(`MISSING path for: ${entry.operationId}`);
      errors++;
    }
    if (!entry.category) {
      console.error(`MISSING category for: ${entry.operationId}`);
      errors++;
    }
  }

  // Verify counts match
  if (catalog.length !== categories.totalEndpoints) {
    console.error(
      `COUNT MISMATCH: catalog has ${catalog.length} entries, categories says ${categories.totalEndpoints}`
    );
    errors++;
  }

  if (errors > 0) {
    console.error(`\nValidation FAILED with ${errors} errors`);
    process.exit(1);
  }

  console.log(`Validation passed: ${catalog.length} endpoints, ${operationIds.size} unique operationIds`);
  console.log(`Categories: ${Object.keys(categories.categories).length}`);
}

main();
