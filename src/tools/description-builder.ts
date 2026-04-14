/**
 * Builds rich, structured tool descriptions and enriches parameter
 * descriptions for high TDQS (Tool Definition Quality Score) scoring.
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
  params: Array<{ name: string; required: boolean }>;
}

/**
 * Build a rich tool description from manifest entry data.
 * Structured to maximize scores across all TDQS dimensions.
 */
export function buildDescription(entry: ManifestEntry): string {
  const parts: string[] = [];

  // Purpose Clarity: Use the full OAS description (richer than summary)
  const rawPurpose =
    entry.description && entry.description.length > entry.summary.length + 5
      ? entry.description
      : entry.summary;
  const purpose = rawPurpose.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  parts.push(purpose.endsWith(".") ? purpose : purpose + ".");

  // Behavioral Transparency: describe what happens based on method + name
  parts.push(getBehavioralContext(entry.method, entry.toolName, entry.path));

  // Usage Guidelines: list required parameters
  const required = entry.params.filter((p) => p.required).map((p) => p.name);
  if (required.length > 0) {
    parts.push(`Required parameters: ${required.join(", ")}.`);
  }

  // Contextual Completeness: category, module, and version
  if (entry.version !== "v1.0" && entry.version !== "unknown") {
    parts.push(
      `Procore API ${entry.version}: ${entry.category} > ${entry.module}.`
    );
  } else {
    parts.push(`Procore API: ${entry.category} > ${entry.module}.`);
  }

  // Endpoint transparency
  parts.push(`Endpoint: ${entry.method} ${entry.path}`);

  return parts.join(" ").slice(0, 1024);
}

function getBehavioralContext(
  method: string,
  toolName: string,
  path: string
): string {
  const name = toolName.toLowerCase();

  switch (method) {
    case "GET": {
      const isList =
        name.startsWith("list_") ||
        name.startsWith("sync_") ||
        name.startsWith("index_") ||
        /\/[a-z_]+$/.test(path);
      if (name.includes("download") || name.includes("export") || name.includes("pdf")) {
        return "Returns the requested file or download URL.";
      }
      if (name.includes("filter_option") || name.includes("filter_value")) {
        return "Returns available filter values as a JSON array.";
      }
      if (isList) {
        return "Returns a paginated JSON array. Use page and per_page to control pagination.";
      }
      return "Returns a JSON object with the full resource details.";
    }
    case "POST": {
      if (name.includes("revoke") || name.includes("disable")) {
        return "Executes the revocation and returns a confirmation on success.";
      }
      if (name.includes("send") || name.includes("invite") || name.includes("email")) {
        return "Sends the notification and returns a confirmation on success.";
      }
      if (name.includes("sync")) {
        return "Synchronizes the data and returns the updated results.";
      }
      if (name.includes("bulk_create")) {
        return "Creates multiple resources in bulk and returns the results (HTTP 201).";
      }
      if (name.includes("bulk_update")) {
        return "Updates multiple resources in bulk and returns the results.";
      }
      if (name.includes("bulk_delete") || name.includes("bulk_destroy") || name.includes("bulk_remove")) {
        return "Removes multiple resources in bulk. This action cannot be undone.";
      }
      if (name.includes("export") || name.includes("download") || name.includes("pdf") || name.includes("csv")) {
        return "Generates the export and returns the download URL or job status.";
      }
      if (name.includes("restore") || name.includes("reactivate")) {
        return "Restores the previously deleted resource and returns it on success.";
      }
      if (name.includes("clone") || name.includes("copy") || name.includes("duplicate")) {
        return "Creates a copy of the resource and returns the new object (HTTP 201).";
      }
      return "Creates a new resource and returns the created object on success (HTTP 201).";
    }
    case "PATCH":
    case "PUT": {
      if (name.includes("send") || name.includes("invite")) {
        return "Sends the notification and returns a confirmation on success.";
      }
      if (name.includes("move")) {
        return "Moves the resource and returns the updated object on success.";
      }
      return "Updates the specified resource and returns the updated object on success.";
    }
    case "DELETE":
      return "Permanently removes the specified resource. This action cannot be undone.";
    default:
      return "";
  }
}

/**
 * Enrich parameter descriptions that are too bare or just restate the name.
 */
export function enrichParamDescription(
  name: string,
  description: string,
  moduleName: string
): string {
  if (description && description.length >= 20) return description;

  const known: Record<string, string> = {
    id: `Unique identifier of the ${moduleName} resource`,
    project_id: "Unique identifier for the Procore project",
    company_id: "Unique identifier for the Procore company",
    page: "Page number for paginated results (default: 1)",
    per_page: "Number of items per page (default: 100, max: 100)",
    token: "OAuth2 access token string to be revoked",
    client_id: "OAuth application client ID from the Procore Developer Portal",
    client_secret:
      "OAuth application client secret from the Procore Developer Portal",
    view: "Response detail level: 'normal' for standard fields, 'extended' for all fields",
    sort: "Sort order for results. Prefix with '-' for descending",
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

  const nameWords = name.replace(/_/g, " ");
  const descNorm = (description || "").toLowerCase().replace(/_/g, " ").trim();
  if (!description || descNorm === nameWords.toLowerCase()) {
    return `The ${nameWords} for this ${moduleName} operation`;
  }

  return description || `The ${nameWords} parameter`;
}
