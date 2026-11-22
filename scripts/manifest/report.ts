/** The generation summary printed after the manifest is written. */
import type { ToolManifestEntry } from "./types.js";

export function printManifestStats(
  manifest: ToolManifestEntry[],
  skippedNonCallable: number
): void {
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
