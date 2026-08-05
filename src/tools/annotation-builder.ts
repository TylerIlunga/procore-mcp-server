/**
 * Builds MCP tool annotations and human-readable titles. Per MCP spec,
 * annotations are advisory hints — but they materially improve TDQS
 * (Tool Definition Quality Score) because they communicate the tool's
 * contract: read-only, idempotent, destructive, open-world.
 */

export interface ToolAnnotationsLike {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Prettify an OAS summary into a Title-Case display name. */
export function buildTitle(summary: string, deprecated = false): string {
  if (!summary) return "";
  const base = summary
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, deprecated ? 66 : 80);
  return deprecated ? `${base} (Deprecated)` : base;
}

export function buildAnnotations(
  method: string,
  toolName: string,
  summary: string,
  deprecated = false
): ToolAnnotationsLike {
  const name = toolName.toLowerCase();
  const title = buildTitle(summary, deprecated);

  const isDestructiveByName =
    name.startsWith("delete_") ||
    name.startsWith("destroy_") ||
    name.startsWith("remove_") ||
    name.startsWith("revoke_") ||
    name.startsWith("disable_") ||
    name.startsWith("deactivate_") ||
    name.includes("bulk_delete") ||
    name.includes("bulk_destroy") ||
    name.includes("bulk_remove");

  switch (method) {
    case "GET":
      return {
        title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      };
    case "DELETE":
      return {
        title,
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      };
    case "PUT":
      return {
        title,
        readOnlyHint: false,
        destructiveHint: isDestructiveByName,
        idempotentHint: true,
        openWorldHint: true,
      };
    case "PATCH":
      // Procore PATCH applies a partial update, so replaying the same body
      // converges on the same state.
      return {
        title,
        readOnlyHint: false,
        destructiveHint: isDestructiveByName,
        idempotentHint: true,
        openWorldHint: true,
      };
    case "POST":
    default:
      return {
        title,
        readOnlyHint: false,
        destructiveHint: isDestructiveByName,
        idempotentHint: name.startsWith("sync_") || name.startsWith("set_"),
        openWorldHint: true,
      };
  }
}
