/** Enrich bare or minimal parameter descriptions with meaningful context. */
export function enrichParamDescription(
  name: string,
  description: string,
  moduleName: string
): string {
  if (description && description.length >= 20) return description;

  const known: Record<string, string> = {
    id: `Unique identifier of the ${moduleName} resource`,
    page: "Page number for paginated results (default: 1)",
    per_page: "Number of items per page (default: 100, max: 100)",
    token: "OAuth2 access token string to be revoked",
    client_id: "OAuth application client ID from the Procore Developer Portal",
    client_secret:
      "OAuth application client secret from the Procore Developer Portal",
    view: "Response detail level. Use 'normal' for standard fields or 'extended' for all fields",
    sort: "Sort order for results. Prefix with '-' for descending order",
    zip: "Postal/ZIP code",
    due_date: "Due date in YYYY-MM-DD format",
    bid_due_date: "Bid due date in YYYY-MM-DD format",
  };

  if (known[name]) return known[name];

  if (name === "project_id") return "Unique identifier for the Procore project";
  if (name === "company_id") return "Unique identifier for the Procore company";
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
    const field = name.replace(/^filters[_[]+/, "").replace(/\]$/, "").replace(/_/g, " ");
    return `Filter results by ${field}`;
  }
  if (name.startsWith("sort__") || name.startsWith("sort[")) {
    return "Field to sort results by. Prefix with '-' for descending order";
  }

  const nameWords = name.replace(/_/g, " ").toLowerCase();
  const descNorm = (description || "").toLowerCase().replace(/_/g, " ").trim();
  if (!description || descNorm === nameWords) {
    return `The ${nameWords} for this ${moduleName} operation`;
  }

  return description || `The ${nameWords} parameter`;
}
