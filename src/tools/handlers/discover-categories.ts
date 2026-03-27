import { getCategories } from "../../catalog/service.js";

export async function handleDiscoverCategories(): Promise<string> {
  const index = getCategories();

  const lines: string[] = [
    `Procore API — ${index.totalEndpoints} total endpoints across ${Object.keys(index.categories).length} categories\n`,
  ];

  for (const [name, data] of Object.entries(index.categories).sort(
    (a, b) => b[1].totalEndpoints - a[1].totalEndpoints
  )) {
    lines.push(`## ${name} (${data.totalEndpoints} endpoints)`);
    const modules = Object.entries(data.modules)
      .sort((a, b) => b[1].endpointCount - a[1].endpointCount)
      .map(([mod, info]) => `  - ${mod}: ${info.endpointCount} endpoints`)
      .join("\n");
    lines.push(modules);
    lines.push("");
  }

  lines.push(
    "Use procore_discover_endpoints with a category and optional module to see specific endpoints."
  );

  return lines.join("\n");
}
