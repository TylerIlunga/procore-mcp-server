/**
 * Parameter description enrichment for auto-generated Procore tools.
 *
 * Split out of description-builder.ts: tool-level prose and parameter-level
 * prose are scored as separate TDQS dimensions and change independently.
 */

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
    id: `Unique identifier of the ${moduleName} resource to act on`,
    project_id:
      "Unique identifier for the Procore project; defaults to the configured project when omitted",
    company_id:
      "Unique identifier for the Procore company; defaults to the configured company when omitted",
    page: "Page number for paginated results (default: 1, 1-indexed)",
    per_page: "Number of items per page (default: 100, max: 100)",
    view: "Response detail level: 'normal' (standard fields), 'extended' (all fields), or 'name' (minimal)",
    sort: "Field to sort results by. Prefix the field name with '-' for descending order",
    zip: "Postal/ZIP code",
    due_date: "Due date in YYYY-MM-DD format",
    bid_due_date: "Bid due date in YYYY-MM-DD format",
  };

  if (known[name]) return known[name];

  if (name.endsWith("_id")) {
    return `Unique identifier of the ${name.replace(/_id$/, "").replace(/_/g, " ")}`;
  }
  if (name.endsWith("_ids")) {
    return `Array of ${name.replace(/_ids$/, "").replace(/_/g, " ")} identifiers`;
  }
  if (name.endsWith("_date")) {
    return `The ${name.replace(/_/g, " ")} in YYYY-MM-DD format`;
  }
  if (name.startsWith("filters__") || name.startsWith("filters[")) {
    const field = name
      .replace(/^filters[_[]+/, "")
      .replace(/\]$/, "")
      .replace(/_/g, " ");
    return `Restricts the returned records to those matching the given ${field}`;
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
  if (text.startsWith(prefix)) return text;
  return prefix + text.charAt(0).toLowerCase() + text.slice(1);
}
