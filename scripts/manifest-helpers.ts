/**
 * Shared helpers for tools manifest generation.
 * Handles tool naming, type mapping, body parsing, and param enrichment.
 */

export interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  enum?: unknown[];
  source: "path" | "query" | "body";
  /** Set when a body field was merged away into an identically named path or
   *  query param. The handler sends the single supplied value to both places. */
  alsoBody?: boolean;
}

const MAX_TOOL_NAME_LENGTH = 64;

/** Mirror of the key transform auto-register applies when building the Zod
 *  shape. Collisions must be detected on this form, not the raw OAS name. */
export function toSchemaKey(name: string): string {
  return name.replace(/\[/g, "__").replace(/\]/g, "").replace(/\./g, "_");
}

const SOURCE_RANK: Record<ToolParam["source"], number> = {
  path: 0,
  query: 1,
  body: 2,
};

/**
 * Collapse params that would land on the same Zod key. Procore routinely
 * repeats an identifier in both the URL and the request body (e.g. company_id
 * on create_permission_template); previously the body entry silently clobbered
 * the path entry in the generated schema, so the agent saw the wrong
 * description for a required path param. Path wins; a dropped body twin is
 * recorded via alsoBody so the value is still sent in the payload.
 */
export function dedupeParams(params: ToolParam[]): ToolParam[] {
  const byKey = new Map<string, ToolParam>();

  for (const param of params) {
    const key = toSchemaKey(param.name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...param });
      continue;
    }

    const winner =
      SOURCE_RANK[param.source] < SOURCE_RANK[existing.source]
        ? { ...param }
        : existing;
    const loser = winner === existing ? param : existing;

    if (loser.source === "body") winner.alsoBody = true;
    if (existing.alsoBody) winner.alsoBody = true;
    // A value required anywhere is required overall.
    winner.required = existing.required || param.required;
    byKey.set(key, winner);
  }

  return [...byKey.values()];
}

/** Convert OAS summary to a clean snake_case tool name */
export function summaryToToolName(
  summary: string,
  method: string,
  path: string,
  version: string
): string {
  let name = summary
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!name || name.length < 3) {
    const segments = path
      .replace(/\/rest\/v[\d.]+\//, "")
      .replace(/\{[^}]+\}/g, "")
      .replace(/\//g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    const prefix =
      method === "GET" ? "get" :
      method === "POST" ? "create" :
      method === "PATCH" ? "update" :
      method === "DELETE" ? "delete" :
      method.toLowerCase();
    name = `${prefix}_${segments}`;
  }

  if (version !== "v1.0" && version !== "unknown") {
    name = `${name}_${version.replace(/\./g, "_")}`;
  }

  return truncateToolName(name);
}

/** Truncate tool name to max length, cutting at word boundary */
export function truncateToolName(
  name: string,
  limit: number = MAX_TOOL_NAME_LENGTH
): string {
  if (name.length <= limit) return name;
  const truncated = name.slice(0, limit);
  const lastUnderscore = truncated.lastIndexOf("_");
  if (lastUnderscore > limit / 2) {
    return truncated.slice(0, lastUnderscore);
  }
  return truncated;
}

/**
 * Append a disambiguating suffix, trimming the base so the suffix always
 * survives. Truncating after concatenation silently discarded the suffix on
 * long names and reintroduced the very collision it was meant to break.
 */
export function withSuffix(base: string, suffix: string): string {
  const tail = suffix.startsWith("_") ? suffix : `_${suffix}`;
  const room = MAX_TOOL_NAME_LENGTH - tail.length;
  return truncateToolName(base, room).replace(/_+$/, "") + tail;
}

export function mapOasTypeToSimple(schema: Record<string, unknown>): string {
  const type = schema.type as string;
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") return "array";
  if (type === "object") return "object";
  return "string";
}

export function truncate(str: string, max: number): string {
  if (!str || str.length <= max) return str || "";
  return str.slice(0, max - 3) + "...";
}

/** Extract body params from OAS request body schema */
export function extractBodyParams(
  schema: Record<string, unknown>,
  moduleName: string
): { params: ToolParam[]; wrapper?: string } {
  const params: ToolParam[] = [];

  if (!schema.properties) return { params };

  const props = schema.properties as Record<string, Record<string, unknown>>;
  const requiredFields = (schema.required as string[]) || [];
  const topKeys = Object.keys(props);

  // Detect wrapper pattern: single top-level key that's an object
  if (topKeys.length === 1) {
    const wrapperKey = topKeys[0];
    const wrapperSchema = props[wrapperKey];
    if (wrapperSchema.type === "object" && wrapperSchema.properties) {
      const innerProps = wrapperSchema.properties as Record<
        string,
        Record<string, unknown>
      >;
      const innerRequired = (wrapperSchema.required as string[]) || [];

      for (const [name, propSchema] of Object.entries(innerProps)) {
        const rawDesc = truncate(
          (propSchema.description as string) || name,
          200
        );
        params.push({
          name,
          type: mapOasTypeToSimple(propSchema),
          required: innerRequired.includes(name),
          description: enrichParamDescription(name, rawDesc, moduleName),
          enum: propSchema.enum as unknown[] | undefined,
          source: "body",
        });
      }
      return { params, wrapper: wrapperKey };
    }
  }

  for (const [name, propSchema] of Object.entries(props)) {
    const rawDesc = truncate(
      (propSchema.description as string) || name,
      200
    );
    params.push({
      name,
      type: mapOasTypeToSimple(propSchema),
      required: requiredFields.includes(name),
      description: enrichParamDescription(name, rawDesc, moduleName),
      enum: propSchema.enum as unknown[] | undefined,
      source: "body",
    });
  }

  return { params };
}

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
