/**
 * Builds rich, structured tool descriptions for high TDQS (Tool Definition
 * Quality Score) scoring on Glama and similar MCP directories. Annotations and
 * titles live in annotation-builder.ts, per-parameter prose in
 * param-descriptions.ts, the synthesized purpose sentence in
 * purpose-builder.ts, and the return/side-effect sentence in
 * behavior-builder.ts.
 *
 * Each emitted sentence targets a distinct scoring dimension and must not
 * restate an earlier one:
 *   1. Purpose Clarity        — what the endpoint acts on, named precisely
 *   2. Usage Guidelines       — when to reach for it, and what to resolve first
 *   3. Behavioral Transparency— what comes back, what changes, how it fails
 *   4. Parameter Semantics    — required inputs
 *   5. Contextual Completeness— where it sits in the Procore API surface
 */
import { deriveResource, ResourceLabel } from "./resource-label.js";
import { buildBehavior } from "./behavior-builder.js";
import {
  synthesizePurpose,
  LIST_SUMMARY,
  isBulkOperation,
  isIdentifierParam,
} from "./purpose-builder.js";

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
  bodyWrapper?: string;
  returnsCollection?: boolean;
  /** Response property that wraps the collection array (v2.x uses "data"). */
  collectionEnvelope?: string;
  deprecated?: boolean;
  deprecatedAt?: string;
  sunset?: string;
}

const DESCRIPTION_MAX = 2048;

/** Identifiers the server can supply itself via procore_set_config. */
const CONFIG_BACKED = new Set(["company_id", "project_id"]);

export function buildDescription(entry: ManifestEntry): string {
  const resource = deriveResource(entry.summary, entry.path, entry.module);
  const parts: string[] = [];

  parts.push(buildPurpose(entry, resource));

  const deprecation = buildDeprecationNotice(entry);
  if (deprecation) parts.push(deprecation);

  const usage = buildUsageGuidance(entry, resource);
  if (usage) parts.push(usage);

  parts.push(buildBehavior(entry, resource));

  const required = entry.params.filter((p) => p.required).map((p) => p.name);
  if (required.length > 0) {
    parts.push(`Required parameters: ${required.join(", ")}.`);
  }

  const versionPart =
    entry.version && entry.version !== "v1.0" && entry.version !== "unknown"
      ? ` (${entry.version})`
      : "";
  parts.push(`Procore API${versionPart}: ${entry.category} > ${entry.module}.`);
  parts.push(`Endpoint: ${entry.method} ${entry.path}`);

  return parts.join(" ").slice(0, DESCRIPTION_MAX);
}

/**
 * Sentence 1. Procore's own prose wins when it says more than the title;
 * otherwise synthesize a sentence naming the real resource.
 */
function buildPurpose(entry: ManifestEntry, resource: ResourceLabel): string {
  const raw = trimToWholeSentence(
    entry.description?.replace(/\s+/g, " ").trim() ?? ""
  );
  const summary = entry.summary?.replace(/\s+/g, " ").trim() ?? "";
  const hasOwnProse = raw.length > summary.length + 5;

  const text = hasOwnProse
    ? raw
    : synthesizePurpose(entry, resource, scopePhrase(entry.path));
  return text.endsWith(".") || text.endsWith("!") ? text : text + ".";
}

/**
 * Catalog generation caps Procore's prose with a trailing "...", which can
 * leave a sentence severed mid-clause. Roll back to the last full sentence so
 * the purpose line always reads as finished prose.
 */
function trimToWholeSentence(text: string): string {
  if (!text.endsWith("...")) return text;
  const body = text.slice(0, -3);
  const lastStop = Math.max(
    body.lastIndexOf(". "),
    body.lastIndexOf("! "),
    body.lastIndexOf("? ")
  );
  // Only roll back if a decent amount of prose survives.
  if (lastStop > 80) return body.slice(0, lastStop + 1);
  return body.trimEnd().replace(/[,;:]$/, "") + ".";
}

/** "in the specified project" / "for the specified company" / "in Procore". */
function scopePhrase(path: string): string {
  if (path.includes("/projects/{")) return "in the specified Procore project";
  if (path.includes("/companies/{")) return "for the specified Procore company";
  return "in Procore";
}

function buildDeprecationNotice(entry: ManifestEntry): string {
  if (!entry.deprecated) return "";
  const sunset = entry.sunset
    ? ` It is scheduled for removal on ${entry.sunset}`
    : " It may be removed without further notice";
  return `DEPRECATED: Procore has deprecated this endpoint${entry.deprecatedAt ? ` (as of ${entry.deprecatedAt})` : ""}.${sunset}; prefer a newer version of this resource where one exists, and use procore_search_endpoints to find it.`;
}

/**
 * Sentence 3. Carries information the purpose and behavior sentences do not:
 * which call to make first, and how to keep the result usable.
 */
function buildUsageGuidance(
  entry: ManifestEntry,
  resource: ResourceLabel
): string {
  const clauses: string[] = [];
  const { singular, plural } = resource;
  const name = entry.toolName.toLowerCase();

  // When to pick this tool.
  if (entry.method === "GET") {
    if (entry.returnsCollection) {
      clauses.push(
        `Use this to discover ${plural} or to look up the id of one before calling a tool that needs it`
      );
    } else if (/^(check|verify|verifies|validate|preview)/.test(name)) {
      clauses.push(
        `Call this before attempting the operation it validates, and act on the verdict it returns`
      );
    } else if (LIST_SUMMARY.test(entry.summary)) {
      clauses.push(
        `Use this to fetch the available ${plural} in one call — the set comes back whole rather than paginated`
      );
    } else {
      clauses.push(
        `Use this when you already know which ${singular} you want and need its full field set`
      );
    }
  } else if (entry.method === "DELETE") {
    if (isBulkOperation(entry)) {
      clauses.push(
        `Confirm every id you pass with the matching show or list tool before calling — one request removes them all`
      );
    } else if (!hasTargetId(entry)) {
      // With a target id the prerequisite clause already says where to find
      // it; repeating the advice here read as two separate instructions.
      clauses.push(
        `Confirm the target id with the matching show or list tool before calling`
      );
    }
  } else if (isBulkOperation(entry)) {
    clauses.push(
      `Prefer this over repeated single-record calls when handling many ${plural} at once`
    );
  } else if (
    (entry.method === "PATCH" || entry.method === "PUT") &&
    !/\/restore$/.test(entry.path)
  ) {
    // A restore endpoint recovers a record; it takes no field updates, so the
    // partial-update guidance does not apply.
    clauses.push(
      `Send only the fields you intend to change; omitted fields keep their current values`
    );
  }

  // Body fields are flattened into the tool's arguments, so say where they go.
  if (entry.method !== "GET" && entry.bodyWrapper) {
    clauses.push(
      `Pass the record's fields as top-level arguments — they are nested under "${entry.bodyWrapper}" in the request payload for you`
    );
  }

  // What has to be resolved first.
  const prerequisite = buildPrerequisite(entry, resource);
  if (prerequisite) clauses.push(prerequisite);

  if (clauses.length === 0) return "";
  return clauses.join(". ") + ".";
}

/** Trailing path segments that name an action rather than a resource. */
const TERMINAL_ACTIONS =
  /^(restore|recycle|recycle_bin|archive|unarchive|close|reopen|publish|send|sync|approve|reject|revoke|withdraw|terminate|restart|refresh|copy|clone|duplicate|pdf|export|download)$/;

/**
 * The path parameter naming the record being acted on: the last identifier in
 * the path, looking past a trailing action segment such as `/restore`. Ids
 * before it name parents — calling the target a "parent record" misled agents
 * into looking for a container that does not exist.
 */
function targetIdOf(entry: ManifestEntry): string | null {
  const segments = entry.path.split("/").filter(Boolean);

  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment.startsWith("{")) {
      // Skip a trailing action, but stop at a real resource segment: in
      // `.../rfis/{rfi_id}/replies` the collection is the target, not the RFI.
      if (TERMINAL_ACTIONS.test(segment)) continue;
      return null;
    }
    const name = segment.slice(1, -1);
    if (CONFIG_BACKED.has(name) || !isIdentifierParam(name)) return null;
    return entry.params.some(
      (p) => p.name === name && p.source === "path" && p.required
    )
      ? name
      : null;
  }
  return null;
}

function hasTargetId(entry: ManifestEntry): boolean {
  return targetIdOf(entry) !== null;
}

/** Names the identifiers the caller must have in hand before calling. */
function buildPrerequisite(
  entry: ManifestEntry,
  resource: ResourceLabel
): string {
  const pathIds = entry.params
    .filter((p) => p.source === "path" && p.required)
    .map((p) => p.name);
  if (pathIds.length === 0) return "";

  const configIds = pathIds.filter((n) => CONFIG_BACKED.has(n));
  const targetId = targetIdOf(entry);
  // Only identifiers name a record to resolve. Path params like `{new_status}`
  // select a mode; telling an agent to look one up in a list tool sends it
  // hunting for a resource that does not exist.
  const parentIds = pathIds.filter(
    (n) => !CONFIG_BACKED.has(n) && n !== targetId && isIdentifierParam(n)
  );

  const clauses: string[] = [];
  if (configIds.length === 1) {
    clauses.push(
      `${configIds[0]} defaults to the value set by procore_set_config when omitted`
    );
  } else if (configIds.length > 1) {
    clauses.push(
      `${configIds.join(" and ")} default to the values set by procore_set_config when omitted`
    );
  }
  if (targetId) {
    const action =
      entry.method === "GET"
        ? "fetch"
        : entry.method === "DELETE"
          ? "delete"
          : "act on";
    clauses.push(
      `${targetId} selects the ${resource.singular} to ${action} — find it with the matching list tool if you do not have it`
    );
  }
  if (parentIds.length > 0) {
    clauses.push(
      `${parentIds.join(", ")} must identify ${
        parentIds.length === 1 ? "an existing parent record" : "existing parent records"
      } — resolve ${parentIds.length === 1 ? "it" : "them"} with the matching list tool first`
    );
  }
  return clauses.join(", and ");
}
