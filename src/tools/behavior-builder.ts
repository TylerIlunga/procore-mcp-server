/**
 * Builds the Behavioral Transparency sentence: what a call returns, what it
 * changes, and how it fails. Split out of description-builder.ts so the
 * return-shape rules can evolve without touching purpose or usage prose.
 */
import { ResourceLabel } from "./resource-label.js";

/** Structural subset of a manifest entry that behavior text depends on. */
export interface BehaviorInput {
  toolName: string;
  method: string;
  description: string;
  returnsCollection?: boolean;
}

/** POST tool names that genuinely create a record. */
const CREATE_PREFIXES =
  /^(create|add|new|register|attach|upload|import|find_or_create)/;

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
 * claimed only when the OAS response schema is genuinely an array.
 */
export function buildBehavior(entry: BehaviorInput, resource: ResourceLabel): string {
  const { singular, plural } = resource;
  const name = entry.toolName.toLowerCase();
  const parts: string[] = [];

  switch (entry.method) {
    case "GET":
      if (entry.returnsCollection) {
        parts.push(
          `Returns a JSON array of ${plural}; page and per_page control pagination and the response reports how many pages remain`
        );
      } else if (/download|export|pdf|csv/.test(name)) {
        parts.push(
          `Returns a JSON object containing the generated file or a download URL for the ${singular}`
        );
      } else {
        parts.push(`Returns a single JSON object describing the ${singular}`);
      }
      parts.push("Read-only — it changes nothing in Procore");
      break;

    case "POST":
      if (/^bulk_(delete|destroy|remove)/.test(name)) {
        parts.push(`Removes the listed ${plural} and cannot be undone`);
      } else if (/^bulk_/.test(name)) {
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
      } else if (/^(restore|reactivate)/.test(name)) {
        parts.push(`Restores the ${singular} and returns the recovered object`);
      } else if (/^(clone|copy|duplicate)/.test(name)) {
        parts.push(
          `Creates an independent copy and returns it (HTTP 201); the original is untouched`
        );
      } else if (/^(update|set|toggle|move|assign)/.test(name)) {
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
      // The usage clause already covers omitted-field semantics.
      parts.push(`Returns the modified ${singular} on success`);
      break;

    case "DELETE":
      parts.push(
        `Permanently removes the ${singular}. This cannot be undone, and a repeat call returns 404`
      );
      break;
  }

  parts.push(
    "Failures come back as an error payload carrying the HTTP status — commonly 401 when the token has expired, 403 without tool permission, and 404 when an id does not resolve"
  );
  return parts.join(". ") + ".";
}
