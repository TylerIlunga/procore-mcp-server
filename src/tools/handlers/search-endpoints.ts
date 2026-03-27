import { searchEndpoints } from "../../catalog/service.js";

export async function handleSearchEndpoints(args: {
  query: string;
}): Promise<string> {
  const results = searchEndpoints(args.query);

  if (results.length === 0) {
    return `No endpoints found matching "${args.query}". Try different search terms or use procore_discover_categories to browse.`;
  }

  const lines: string[] = [
    `Found ${results.length} endpoints matching "${args.query}":\n`,
  ];

  for (const e of results) {
    lines.push(
      `- **${e.method}** \`${e.path}\` — ${e.summary}`
    );
    lines.push(
      `  Category: ${e.category} / ${e.module} | operationId: \`${e.operationId}\``
    );
  }

  lines.push(
    "\nUse procore_get_endpoint_details with an operationId for full parameter info."
  );

  return lines.join("\n");
}
