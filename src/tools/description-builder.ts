/**
 * Builds rich, structured tool descriptions and parameter docs for high
 * TDQS (Tool Definition Quality Score) scoring on Glama and similar MCP
 * directories. Annotations and titles live in annotation-builder.ts.
 *
 * Covers: Purpose Clarity, Usage Guidelines, Behavioral Transparency,
 * Parameter Semantics, and Contextual Completeness.
 */

interface ManifestEntry {
  toolName: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  category: string;
  module: string;
  version: string;
  params: Array<{ name: string; required: boolean; source?: string }>;
}

const DESCRIPTION_MAX = 2048;

/**
 * Build a rich tool description from manifest entry data.
 * Structured to maximize scores across all TDQS dimensions.
 */
export function buildDescription(entry: ManifestEntry): string {
  const parts: string[] = [];

  // Purpose Clarity: prefer the longer OAS description over the bare summary.
  const rawPurpose =
    entry.description && entry.description.length > entry.summary.length + 5
      ? entry.description
      : entry.summary;
  const purpose = rawPurpose.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  parts.push(purpose.endsWith(".") ? purpose : purpose + ".");

  // Usage Guidelines: explain when an LLM should reach for this tool.
  const useCase = buildUseCase(entry);
  if (useCase) parts.push(useCase);

  // Behavioral Transparency: what the call returns / what it changes.
  parts.push(buildBehavioralContext(entry));

  // Parameter Semantics: required params front-and-center.
  const required = entry.params.filter((p) => p.required).map((p) => p.name);
  if (required.length > 0) {
    parts.push(`Required parameters: ${required.join(", ")}.`);
  }

  // Contextual Completeness: where this lives in the Procore API surface.
  const versionPart =
    entry.version && entry.version !== "v1.0" && entry.version !== "unknown"
      ? ` (${entry.version})`
      : "";
  parts.push(`Procore API${versionPart}: ${entry.category} > ${entry.module}.`);

  parts.push(`Endpoint: ${entry.method} ${entry.path}`);

  return parts.join(" ").slice(0, DESCRIPTION_MAX);
}

/** Resource-aware "use this when" sentence derived from name + module. */
function buildUseCase(entry: ManifestEntry): string {
  const name = entry.toolName.toLowerCase();
  const resource = inferResourceLabel(entry);
  const m = entry.method;

  if (m === "GET") {
    if (
      name.startsWith("list_") ||
      name.startsWith("index_") ||
      name.startsWith("sync_")
    ) {
      return `Use this to enumerate ${resource} when you need a paginated overview, to find IDs, or to filter by query parameters.`;
    }
    if (name.startsWith("show_") || name.startsWith("get_") || name.startsWith("retrieve_") || name.startsWith("fetch_")) {
      return `Use this to fetch the full details of a specific ${resource} by its identifier.`;
    }
    if (name.includes("filter_option") || name.includes("filter_value")) {
      return `Use this to populate a filter UI with the valid values for ${resource}.`;
    }
    if (name.includes("download") || name.includes("export") || name.includes("pdf") || name.includes("csv")) {
      return `Use this to retrieve a downloadable file or export URL for ${resource}.`;
    }
    return `Use this to read information about ${resource} from Procore.`;
  }
  if (m === "POST") {
    if (name.startsWith("create_") || name.startsWith("add_")) {
      return `Use this to create a new ${resource} in Procore.`;
    }
    if (name.startsWith("bulk_create")) {
      return `Use this to create many ${resource} records in a single request.`;
    }
    if (name.startsWith("bulk_update")) {
      return `Use this to update many ${resource} records in a single request.`;
    }
    if (name.startsWith("bulk_delete") || name.startsWith("bulk_remove") || name.startsWith("bulk_destroy")) {
      return `Use this to delete many ${resource} records in a single request — this cannot be undone.`;
    }
    if (name.startsWith("clone_") || name.startsWith("copy_") || name.startsWith("duplicate_")) {
      return `Use this to duplicate an existing ${resource} as a new record.`;
    }
    if (name.startsWith("send_") || name.startsWith("invite_") || name.includes("email")) {
      return `Use this to dispatch the notification or message related to ${resource}.`;
    }
    if (name.startsWith("revoke_") || name.startsWith("disable_") || name.startsWith("deactivate_")) {
      return `Use this to revoke or disable the specified ${resource}.`;
    }
    if (name.startsWith("restore_") || name.startsWith("reactivate_")) {
      return `Use this to restore or reactivate a previously deleted ${resource}.`;
    }
    if (name.startsWith("sync_")) {
      return `Use this to bulk-synchronize ${resource} with an external system of record.`;
    }
    return `Use this to perform the ${prettyAction(name)} action on ${resource}.`;
  }
  if (m === "PATCH" || m === "PUT") {
    if (name.startsWith("send_") || name.includes("invite") || name.includes("email")) {
      return `Use this to dispatch the notification or message related to ${resource}.`;
    }
    if (name.startsWith("move_") || name.startsWith("reorder_")) {
      return `Use this to move or reorder a ${resource} within its parent collection.`;
    }
    return `Use this to update an existing ${resource} (only the supplied fields are changed).`;
  }
  if (m === "DELETE") {
    return `Use this to permanently delete the specified ${resource}. This cannot be undone.`;
  }
  return "";
}

function buildBehavioralContext(entry: ManifestEntry): string {
  const name = entry.toolName.toLowerCase();
  const resource = inferResourceLabel(entry);
  const m = entry.method;

  switch (m) {
    case "GET": {
      const isList =
        name.startsWith("list_") ||
        name.startsWith("sync_") ||
        name.startsWith("index_") ||
        /\/[a-z_]+$/.test(entry.path);
      if (name.includes("download") || name.includes("export") || name.includes("pdf")) {
        return `Returns a JSON object with the file contents or download URL for ${resource}.`;
      }
      if (name.includes("filter_option") || name.includes("filter_value")) {
        return `Returns a JSON array of available filter values for ${resource}.`;
      }
      if (isList) {
        return `Returns a paginated JSON array of ${resource}. Use page and per_page to control pagination; the response includes pagination metadata.`;
      }
      return `Returns a JSON object describing the requested ${resource}.`;
    }
    case "POST": {
      if (name.includes("revoke") || name.includes("disable") || name.includes("deactivate")) {
        return "Executes the action and returns a confirmation. Repeated calls are safe.";
      }
      if (name.includes("send") || name.includes("invite") || name.includes("email")) {
        return "Dispatches the message and returns a confirmation. Repeated calls may resend.";
      }
      if (name.includes("sync")) {
        return `Synchronizes ${resource} with the supplied data and returns the updated server-side state.`;
      }
      if (name.startsWith("bulk_create")) {
        return `Creates many ${resource} records in one request and returns the created collection (HTTP 201). Partial failures may occur — check each item's status.`;
      }
      if (name.startsWith("bulk_update")) {
        return `Updates many ${resource} records in one request and returns the updated collection.`;
      }
      if (name.startsWith("bulk_delete") || name.startsWith("bulk_destroy") || name.startsWith("bulk_remove")) {
        return `Removes many ${resource} records in one request. This cannot be undone.`;
      }
      if (name.includes("export") || name.includes("download") || name.includes("pdf") || name.includes("csv")) {
        return "Generates the export and returns a download URL or async job handle.";
      }
      if (name.includes("restore") || name.includes("reactivate")) {
        return `Restores the previously deleted ${resource} and returns the recovered object.`;
      }
      if (name.startsWith("clone") || name.startsWith("copy") || name.startsWith("duplicate")) {
        return `Creates a copy of the ${resource} and returns the newly created object (HTTP 201).`;
      }
      return `Creates a new ${resource} and returns the created object on success (HTTP 201).`;
    }
    case "PATCH":
    case "PUT": {
      if (name.includes("send") || name.includes("invite")) {
        return "Triggers the notification and returns a confirmation.";
      }
      if (name.includes("move")) {
        return `Moves the ${resource} to its new position and returns the updated object.`;
      }
      return `Updates the specified ${resource} and returns the modified object on success.`;
    }
    case "DELETE":
      return `Permanently removes the specified ${resource}. This action cannot be undone.`;
    default:
      return "";
  }
}

/** Infer a human-readable resource label for behavioral text. */
function inferResourceLabel(entry: ManifestEntry): string {
  const moduleName = entry.module || "Procore";
  const lower = moduleName.toLowerCase();
  if (lower === "procore" || !moduleName) return "Procore records";
  return moduleName.endsWith("s") ? moduleName : `${moduleName} records`;
}

function prettyAction(name: string): string {
  return name.split("_").slice(0, 2).join(" ").replace(/_/g, " ");
}

/**
 * Enrich parameter descriptions that are too bare or just restate the name,
 * and prepend a source hint so callers know where the value travels.
 */
export function enrichParamDescription(
  name: string,
  description: string,
  moduleName: string,
  source?: "path" | "query" | "body"
): string {
  const base = enrichBase(name, description, moduleName);
  return prefixWithSource(base, source);
}

function enrichBase(
  name: string,
  description: string,
  moduleName: string
): string {
  if (description && description.length >= 20) return description;

  const known: Record<string, string> = {
    id: `Unique identifier of the ${moduleName} resource`,
    project_id: "Unique identifier for the Procore project",
    company_id: "Unique identifier for the Procore company",
    page: "Page number for paginated results (default: 1, 1-indexed)",
    per_page: "Number of items per page (default: 100, max: 100)",
    token: "OAuth2 access token string to be revoked",
    client_id: "OAuth application client ID from the Procore Developer Portal",
    client_secret:
      "OAuth application client secret from the Procore Developer Portal",
    view: "Response detail level: 'normal' (standard fields), 'extended' (all fields), or 'name' (minimal)",
    sort: "Sort order for results. Prefix the field name with '-' for descending",
    zip: "Postal/ZIP code",
    due_date: "Due date in YYYY-MM-DD format",
    bid_due_date: "Bid due date in YYYY-MM-DD format",
  };

  if (known[name]) return known[name];

  if (name.endsWith("_id")) {
    const resource = name.replace(/_id$/, "").replace(/_/g, " ");
    return `Unique identifier of the ${resource}`;
  }
  if (name.endsWith("_ids")) {
    const resource = name.replace(/_ids$/, "").replace(/_/g, " ");
    return `Array of ${resource} identifiers`;
  }
  if (name.endsWith("_date")) {
    const field = name.replace(/_/g, " ");
    return `The ${field} in YYYY-MM-DD format`;
  }
  if (name.startsWith("filters__") || name.startsWith("filters[")) {
    const field = name
      .replace(/^filters[_[]+/, "")
      .replace(/\]$/, "")
      .replace(/_/g, " ");
    return `Filter results by ${field}`;
  }

  const nameWords = name.replace(/_/g, " ");
  const descNorm = (description || "").toLowerCase().replace(/_/g, " ").trim();
  if (!description || descNorm === nameWords.toLowerCase()) {
    return `The ${nameWords} for this ${moduleName} operation`;
  }

  return description || `The ${nameWords} parameter`;
}

function prefixWithSource(
  text: string,
  source?: "path" | "query" | "body"
): string {
  if (!source) return text;
  const prefix =
    source === "path"
      ? "URL path parameter — "
      : source === "query"
        ? "Query string parameter — "
        : "JSON request body field — ";
  // Avoid double-prefixing if generation pipeline already added it.
  if (text.startsWith(prefix)) return text;
  return prefix + text.charAt(0).toLowerCase() + text.slice(1);
}
