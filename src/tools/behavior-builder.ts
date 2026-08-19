/**
 * Builds the Behavioral Transparency sentence: what a call returns, what it
 * changes, and how it fails. Split out of description-builder.ts so the
 * return-shape rules can evolve without touching purpose or usage prose.
 */
import { ResourceLabel } from "./resource-label.js";
import {
  LIST_SUMMARY,
  UPSERT_NAME,
  ASSOCIATION_REMOVAL_NAME,
  isBulkOperation,
} from "./purpose-builder.js";

/** Structural subset of a manifest entry that behavior text depends on. */
export interface BehaviorInput {
  toolName: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  returnsCollection?: boolean;
  /** Response property that wraps the collection array (v2.x uses "data"). */
  collectionEnvelope?: string;
  params?: Array<{ name: string; required: boolean; source?: string }>;
}

/** POST tool names that genuinely create a record. */
const CREATE_PREFIXES =
  /^(create|add|new|register|attach|upload|import|find_or_create)/;

/** Endpoints that recycle rather than destroy, by name or documented prose. */
function isSoftDelete(entry: BehaviorInput): boolean {
  return (
    /recycl/i.test(entry.toolName) ||
    /recycl|soft.?delete/i.test(entry.summary || "") ||
    /recycl|soft.?delete|can be restored/i.test(entry.description || "")
  );
}

/**
 * True when Procore's own prose already spells out status codes or retry
 * semantics. In that case the synthesized behavior sentence must stay neutral
 * rather than risk contradicting the documented contract.
 */
function documentsOwnBehavior(entry: BehaviorInput): boolean {
  const prose = entry.description || "";
  return /idempot|\b(20[0-9]|4[0-9]{2})\b|no content/i.test(prose);
}

/**
 * Sentence 4. Return shape, side effects, and failure mode. Pagination is
 * claimed only for genuine collections, where the input schema also offers
 * page and per_page.
 */
export function buildBehavior(entry: BehaviorInput, resource: ResourceLabel): string {
  const { singular, plural } = resource;
  const name = entry.toolName.toLowerCase();
  const bulk = entry.method !== "GET" && isBulkOperation(entry);
  const parts: string[] = [];

  switch (entry.method) {
    case "GET":
      if (entry.returnsCollection) {
        parts.push(
          entry.collectionEnvelope
            ? `Returns the matching ${plural} as a JSON array under the response's "${entry.collectionEnvelope}" key; page and per_page control pagination`
            : `Returns a JSON array of ${plural}; page and per_page control pagination and the response reports how many pages remain`
        );
      } else if (/download|export|pdf|csv/.test(name)) {
        parts.push(
          `Returns a JSON object containing the generated file or a download URL for the ${singular}`
        );
      } else if (LIST_SUMMARY.test(entry.summary)) {
        parts.push(
          `Returns a single JSON object grouping the available ${plural}`
        );
      } else {
        parts.push(`Returns a single JSON object describing the ${singular}`);
      }
      parts.push("Read-only — it changes nothing in Procore");
      break;

    case "POST":
      if (UPSERT_NAME.test(name)) {
        parts.push(
          `Creates the ${singular} or updates the matching existing one, and returns it — safe to repeat without creating duplicates`
        );
      } else if (/^(recycle|recycles)/.test(name)) {
        parts.push(
          `Soft-deletes the ${/bulk|in_bulk/.test(name) ? plural : singular}: recycled records move to the recycle bin and an admin can restore them`
        );
      } else if (/^bulk_(delete|destroy|remove)/.test(name)) {
        parts.push(`Removes the listed ${plural} and cannot be undone`);
      } else if (/^(bulk|batch)_/.test(name)) {
        parts.push(
          `Processes every supplied record in one request and returns the resulting collection; individual entries can fail independently, so check each one`
        );
      } else if (/^(send|invite|email|notify)/.test(name)) {
        parts.push(
          "Dispatches the message and returns a confirmation; calling it again sends another copy"
        );
      } else if (/^(sync)/.test(name)) {
        parts.push(
          `Reconciles ${plural} against the payload you supply and returns the resulting server-side state`
        );
      } else if (/^(restore|restoring|reactivate)/.test(name) || /\/restore$/.test(entry.path)) {
        parts.push(`Restores the ${singular} and returns the recovered object`);
      } else if (/^(clone|copy|duplicate)/.test(name)) {
        parts.push(
          `Creates an independent copy and returns it (HTTP 201); the original is untouched`
        );
      } else if (/^(check|verify|verifies|validate|calculate|preview|search)/.test(name)) {
        parts.push(
          `Returns the computed result and persists no change of its own`
        );
      } else if (
        /^(update|set|toggle|move|assign|unassign|reorder|reopen|close|link|unlink|mark|complete|stop|terminate|restart|refresh|respond|review)/.test(name)
      ) {
        parts.push(`Applies the change and returns the updated ${singular}`);
      } else if (CREATE_PREFIXES.test(name) && !documentsOwnBehavior(entry)) {
        parts.push(
          `Creates the ${singular} and returns it with its new id (HTTP 201); calling it again creates another record`
        );
      } else {
        // Not every POST is a create — several are state transitions whose
        // semantics Procore documents itself. Assert nothing that could
        // contradict the purpose text above.
        parts.push(
          `Acts on the ${singular} and returns Procore's response for the operation`
        );
      }
      break;

    case "PATCH":
    case "PUT":
      if (UPSERT_NAME.test(name)) {
        parts.push(
          `Creates the ${singular} or updates the matching existing one, and returns it — safe to repeat without creating duplicates`
        );
      } else if (/^(restore|restoring|reactivate)/.test(name) || /\/restore$/.test(entry.path)) {
        parts.push(`Restores the ${singular} and returns the recovered object`);
      } else if (bulk) {
        parts.push(
          `Returns the modified ${plural}; entries can fail independently, so check each one in the response`
        );
      } else {
        // The usage clause already covers omitted-field semantics.
        parts.push(`Returns the modified ${singular} on success`);
      }
      break;

    case "DELETE":
      // Soft delete is checked before bulk: a bulk recycle is still a recycle,
      // and claiming it "cannot be undone" would be wrong.
      if (isSoftDelete(entry)) {
        parts.push(
          bulk
            ? `Soft-deletes every ${singular} you list: they move to the recycle bin, where an admin can restore them`
            : `Soft-deletes the ${singular}: it moves to the recycle bin, where an admin can restore it. A repeat call returns 404`
        );
      } else if (bulk) {
        parts.push(
          `Permanently removes every ${singular} you list. This cannot be undone, and ids that no longer resolve are reported in the response`
        );
      } else if (ASSOCIATION_REMOVAL_NAME.test(name)) {
        parts.push(
          `Removes only the association — the underlying records are not deleted. A repeat call returns 404`
        );
      } else {
        parts.push(
          `Permanently removes the ${singular}. This cannot be undone, and a repeat call returns 404`
        );
      }
      break;
  }

  parts.push(
    "Failures come back as an error payload carrying the HTTP status — commonly 401 when the token has expired, 403 without tool permission, and 404 when an id does not resolve"
  );
  return parts.join(". ") + ".";
}
