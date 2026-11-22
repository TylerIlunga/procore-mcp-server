/**
 * Tool naming: OAS summary -> snake_case tool name, the 64-char cap, and the
 * suffix helpers collision resolution uses to keep a disambiguator intact.
 */

const MAX_TOOL_NAME_LENGTH = 64;

/**
 * Names for endpoints whose OAS summary produces an unusable tool name —
 * typically prose that the 64-char cap would sever mid-phrase. Keyed by
 * `METHOD path` so the override survives spec refreshes that reword the
 * summary.
 */
const NAME_OVERRIDES: Record<string, string> = {
  "GET /rest/v2.0/companies/{company_id}/users/bulk/status/{id}":
    "get_bulk_users_async_job_status",
  "GET /rest/v2.0/companies/{company_id}/projects/{project_id}/budget_notes/{wbs_code_id}":
    "get_budget_note",
  // Both summaries read just "Bulk Create"; name what is being created.
  "POST /rest/v1.1/projects/{project_id}/project_timecard_entries/bulk_create":
    "bulk_create_project_timecard_entries",
  "POST /rest/v1.0/companies/{company_id}/projects/{project_id}/equipment_timecard_entries/bulk_create":
    "bulk_create_equipment_timecard_entries",
};

/** Collapse consecutive duplicate tokens ("a_specification_specification_b"
 *  -> "a_specification_b") introduced when a suffix repeats the name's tail. */
export function collapseStutter(name: string): string {
  const tokens = name.split("_");
  const out: string[] = [];
  for (const token of tokens) {
    if (out[out.length - 1] !== token) out.push(token);
  }
  return out.join("_");
}

/**
 * Procore annotates some summaries with the API version in parentheses:
 * "Create a coordination issue (REST v2.0)", "List Calendars (V2.1)". The
 * version suffix below already comes from the *path*, so the annotation only
 * produced names like `create_a_coordination_issue_rest_v2_0` -- and it is
 * sometimes wrong ("(V1.1)" on a v1.0 path). Drop the version tokens, keep any
 * real qualifier that shares the parenthetical ("REST v2.0, issue-scoped" ->
 * "issue-scoped"), and drop the parenthetical if nothing else is left.
 */
export function stripVersionAnnotation(summary: string): string {
  return summary
    .replace(/\(([^)]*)\)/g, (_whole, inner: string) => {
      const kept = inner
        .replace(/\b(?:REST\s+)?v\d+(?:\.\d+)?\b/gi, "")
        .replace(/^[\s,;]+|[\s,;]+$/g, "")
        .replace(/\s*[,;]\s*[,;]\s*/g, ", ");
      return kept ? `(${kept})` : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Convert OAS summary to a clean snake_case tool name */
export function summaryToToolName(
  summary: string,
  method: string,
  path: string,
  version: string
): string {
  const override = NAME_OVERRIDES[`${method} ${path}`];
  if (override) return override;

  let name = stripVersionAnnotation(summary)
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

  // Procore titles recycle-bin recovery endpoints "Retrieve Recycled ..." —
  // but a PATCH/POST ending in /restore recovers the record; name it so.
  if (method !== "GET" && /\/restore$/.test(path)) {
    name = name.replace(/^(retrieve|get)_/, "restore_");
  }

  if (version !== "v1.0" && version !== "unknown") {
    name = `${name}_${version.replace(/\./g, "_")}`;
  }

  return truncateToolName(name);
}

/** Function words that read as garbage when a truncated name ends on them. */
const DANGLING_TAIL = new Set([
  "a", "an", "the", "of", "for", "to", "by", "with", "and", "or", "in", "on",
  "that", "its", "from", "as", "is", "are", "this", "their", "when", "if",
]);

/**
 * Truncate tool name to max length, cutting at a word boundary and then
 * shedding any function-word tail the cut stranded: a 64-char cap on
 * "get_divisions_and_sets_options_for_specification_sections_for_a" must not
 * end at "for_a".
 */
export function truncateToolName(
  name: string,
  limit: number = MAX_TOOL_NAME_LENGTH
): string {
  if (name.length <= limit) return name;
  let truncated = name.slice(0, limit);
  const lastUnderscore = truncated.lastIndexOf("_");
  if (lastUnderscore > limit / 2) {
    truncated = truncated.slice(0, lastUnderscore);
  }

  const tokens = truncated.split("_");
  while (tokens.length > 2 && DANGLING_TAIL.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join("_");
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
