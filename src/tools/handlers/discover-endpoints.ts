import { discoverEndpoints } from "../../catalog/service.js";

export async function handleDiscoverEndpoints(args: {
  category?: string;
  module?: string;
  search?: string;
  method_filter?: string;
}): Promise<string> {
  const entries = discoverEndpoints({
    category: args.category,
    module: args.module,
    search: args.search,
    methodFilter: args.method_filter,
  });

  if (entries.length === 0) {
    return "No endpoints found matching the given filters. Try broadening your search or use procore_discover_categories to see available categories.";
  }

  const lines: string[] = [`Found ${entries.length} endpoints:\n`];

  // Group by module for readability
  const grouped = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = `${entry.category} / ${entry.module}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry);
  }

  for (const [group, items] of grouped) {
    lines.push(`### ${group}`);
    for (const e of items) {
      lines.push(
        `- **${e.method}** \`${e.path}\` — ${e.summary} [${e.operationId}]`
      );
    }
    lines.push("");
  }

  if (entries.length > 0) {
    lines.push(
      "Use procore_get_endpoint_details with an operationId to see full parameter details."
    );
  }

  return lines.join("\n");
}
