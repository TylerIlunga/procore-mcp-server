/**
 * Synthesizes the Purpose Clarity sentence used when Procore's own prose adds
 * nothing beyond the operation title. The cardinal rule: never claim CRUD
 * semantics the tool's name does not carry. A POST named reorder_* must not
 * read "Creates", a GET named list_* must not read "Retrieves a single", and
 * a DELETE named recycle_* must not read "Permanently removes".
 */
import { ResourceLabel, articleFor, applyCasing } from "./resource-label.js";

export interface PurposeInput {
  toolName: string;
  method: string;
  path: string;
  summary: string;
  returnsCollection?: boolean;
  params?: Array<{ name: string; required: boolean; source?: string }>;
}

/**
 * True when one call acts on many records. Bulk endpoints were previously
 * described in the singular — "Deletes a company segment item", "Confirm the
 * target id" — on tools whose only required argument is a list of ids.
 */
export function isBulkOperation(entry: PurposeInput): boolean {
  // A path closing on an identifier addresses exactly one record, whatever
  // the surrounding segments are named — `.../bulk_replace_requests/{id}` is
  // a single request whose resource merely has "bulk" in its name. A
  // non-identifier terminal param such as `{new_status}` selects a mode, not
  // a record, so it does not rule out a bulk call.
  const lastSegment = entry.path.split("/").filter(Boolean).pop() || "";
  if (lastSegment.startsWith("{") && isIdentifierParam(lastSegment.slice(1, -1))) {
    return false;
  }

  const name = entry.toolName.toLowerCase();
  if (/^(bulk|batch)_/.test(name)) return true;
  if (/^(sync|syncs)_/.test(name)) return true;
  if (/^(update|delete|destroy|remove)_(all|multiple)_/.test(name)) return true;
  // Only a trailing bulk_* action segment marks a bulk endpoint.
  if (/\/(bulk|batch)(_\w+)?$/.test(entry.path)) return true;
  return (entry.params || []).some(
    (p) => p.required && p.source !== "path" && /_ids$/.test(p.name)
  );
}

/** Summaries that promise a set of records rather than a single one. */
export const LIST_SUMMARY =
  /^(list|lists|index|search|get all|gets all|retrieve all|retrieves all|return all|returns all|show all|shows all|return a list|returns a list|get a list|gets a list|get the list)\b/i;

const CREATE_VERBS = new Set([
  "create", "creates", "add", "adds", "register", "registers", "attach",
  "attaches", "upload", "uploads", "import", "imports", "post", "draft", "new",
]);
const UPDATE_VERBS = new Set([
  "update", "updates", "edit", "edits", "modify", "modifies", "patch",
  "set", "sets", "toggle", "toggles",
]);
const DELETE_VERBS = new Set([
  "delete", "deletes", "destroy", "destroys", "remove", "removes",
]);
const CHECK_VERBS = new Set([
  "check", "checks", "verify", "verifies", "validate", "validates",
  "preview", "previews", "calculate", "calculates",
]);
const RECYCLE_VERBS = new Set(["recycle", "recycles"]);
const RESTORE_VERBS = new Set([
  "restore", "restores", "restoring", "reactivate", "reactivates",
]);

/** Idempotent create-or-update names — a repeat call must not "duplicate". */
export const UPSERT_NAME =
  /^(creates?_or_(updates?|finds?)|find_or_create|finds_or_creates|get_or_create|gets_or_creates|update_or_create|creates?_update)/;

/** Names that remove an association or membership, not the record itself. */
export const ASSOCIATION_REMOVAL_NAME =
  /^(remove|delete|revoke)s?_(\w+_)*from_|^(unassign|disassociate|unlink)/;

/** True for path params that name a record ("id", "rfi_id"), not a mode. */
export function isIdentifierParam(name: string): boolean {
  return name === "id" || /_id$/.test(name);
}

/** Leading verb of the tool name, looking past a bulk_/batch_ prefix. */
export function leadingVerb(toolName: string): string {
  const tokens = toolName.toLowerCase().split("_");
  const first = tokens[0] || "";
  if ((first === "bulk" || first === "batch") && tokens[1]) return tokens[1];
  return first;
}

/** "Reorder" -> "Reorders"; leaves words already in third person alone. */
function thirdPerson(word: string): string {
  const lower = word.toLowerCase();
  if (lower.endsWith("s")) return word;
  if (/(sh|ch|x|z|o)$/.test(lower)) return word + "es";
  if (/[^aeiou]y$/.test(lower)) return word.slice(0, -1) + "ies";
  return word + "s";
}

/**
 * Turns an imperative operation title into a declarative sentence that keeps
 * every word of meaning: "Reorder Company Role" -> "Reorders company roles".
 * Used for the non-CRUD verbs where a template would misstate the action.
 */
function sentenceFromSummary(summary: string, scope: string): string {
  const base = summary
    .replace(/\s*\([^)]*\)\s*$/g, " ") // trailing "(Project)" / "(Company)"
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!]+$/, "");
  if (!base) return `Performs this operation ${scope}`;

  const words = base.split(" ");
  const verb = thirdPerson(words[0]);
  const rest = applyCasing(words.slice(1).join(" "));
  const sentence = rest ? `${verb.charAt(0).toUpperCase()}${verb.slice(1).toLowerCase()} ${rest}` : verb;
  return `${sentence} ${scope}`;
}

/** Plural purpose sentence for a bulk endpoint, or "" to fall through. */
function bulkPurpose(
  entry: PurposeInput,
  plural: string,
  scope: string
): string {
  const verb = leadingVerb(entry.toolName);

  if (RECYCLE_VERBS.has(verb) || /recycl/i.test(entry.toolName)) {
    return `Moves multiple ${plural} ${scope} to the recycle bin in one request — a soft delete an admin can undo`;
  }
  if (DELETE_VERBS.has(verb) || /_(destroy|delete|remove)(_|$)/.test(entry.toolName)) {
    return `Deletes multiple ${plural} ${scope} in a single request`;
  }
  if (verb === "sync" || verb === "syncs") {
    return `Reconciles the ${plural} ${scope} against the set you supply, creating, updating, and removing records so they match`;
  }
  if (CREATE_VERBS.has(verb)) {
    return `Creates multiple ${plural} ${scope} in a single request`;
  }
  if (UPDATE_VERBS.has(verb)) {
    return `Updates multiple ${plural} ${scope} in a single request`;
  }
  return "";
}

function recycleSentence(resource: ResourceLabel, scope: string): string {
  const { singular } = resource;
  return `Moves ${articleFor(singular)} ${singular} to the recycle bin ${scope} — a soft delete that an admin can undo by restoring it`;
}

/** The synthesized purpose sentence (no trailing period). */
export function synthesizePurpose(
  entry: PurposeInput,
  resource: ResourceLabel,
  scope: string
): string {
  const { singular, plural } = resource;
  const a = articleFor(singular);
  const verb = leadingVerb(entry.toolName);

  // A non-GET path ending in /restore recovers the record from the recycle
  // bin, whatever the operation title says.
  if (entry.method !== "GET" && /\/restore$/.test(entry.path)) {
    return `Restores ${a} recycled ${singular} out of the recycle bin ${scope}`;
  }

  // Bulk endpoints act on many records per call; the singular CRUD templates
  // below would understate what one call does.
  if (entry.method !== "GET" && isBulkOperation(entry)) {
    const bulk = bulkPurpose(entry, plural, scope);
    if (bulk) return bulk;
  }

  switch (entry.method) {
    case "GET":
      if (entry.returnsCollection) {
        return `Lists the ${plural} recorded ${scope}`;
      }
      if (CHECK_VERBS.has(verb)) {
        return sentenceFromSummary(entry.summary, scope);
      }
      if (LIST_SUMMARY.test(entry.summary)) {
        // A list-titled endpoint whose response is a keyed object rather than
        // a paginated array (common for filter-option and settings payloads).
        return `Retrieves the full set of ${plural} ${scope}`;
      }
      return `Retrieves ${a} single ${singular} ${scope}`;

    case "POST":
      if (UPSERT_NAME.test(entry.toolName)) {
        return `Creates ${a} ${singular} ${scope}, or updates the one that already matches`;
      }
      if (RECYCLE_VERBS.has(verb)) return recycleSentence(resource, scope);
      if (RESTORE_VERBS.has(verb)) {
        return `Restores ${a} previously recycled ${singular} ${scope}`;
      }
      if (DELETE_VERBS.has(verb)) {
        return `Removes the specified ${plural} ${scope}`;
      }
      if (CREATE_VERBS.has(verb)) {
        return `Creates ${a} new ${singular} ${scope}`;
      }
      // sync, send, reorder, assign, close, respond, clone, and the rest:
      // restate the operation itself rather than guessing a CRUD template.
      return sentenceFromSummary(entry.summary, scope);

    case "PATCH":
    case "PUT":
      if (UPSERT_NAME.test(entry.toolName)) {
        return `Creates ${a} ${singular} ${scope}, or updates the one that already matches`;
      }
      if (UPDATE_VERBS.has(verb)) {
        return `Updates an existing ${singular} ${scope}`;
      }
      return sentenceFromSummary(entry.summary, scope);

    case "DELETE":
      if (ASSOCIATION_REMOVAL_NAME.test(entry.toolName)) {
        // What gets deleted is the association, not the record itself.
        return sentenceFromSummary(entry.summary, scope);
      }
      if (RECYCLE_VERBS.has(verb) || /recycl/i.test(entry.summary)) {
        return recycleSentence(resource, scope);
      }
      if (DELETE_VERBS.has(verb)) {
        return `Deletes ${a} ${singular} ${scope}`;
      }
      return sentenceFromSummary(entry.summary, scope);

    default:
      return `Operates on ${plural} ${scope}`;
  }
}
