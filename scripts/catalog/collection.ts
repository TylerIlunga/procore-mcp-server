/**
 * Collection detection: decides whether a GET genuinely returns a list, so
 * pagination is advertised only where it applies (`returnsCollection`), and
 * which envelope key wraps the array (`collectionEnvelope`).
 */
import type { OASOperation } from "./types.js";

/** Response properties that conventionally wrap the real payload. */
const ENVELOPE_KEYS = ["data", "items", "results", "records", "entries"] as const;

type CollectionVerdict =
  | { kind: "collection"; envelope?: string }
  | { kind: "single" }
  /** An envelope whose element the spec draws as one object. Procore's v2
   *  specs routinely do this on genuine list endpoints, so the caller must
   *  weigh the summary before concluding "single". */
  | { kind: "ambiguous-envelope"; envelope: string }
  | null;

/**
 * Decide whether a 2xx response body is a collection. Unwraps allOf/oneOf/anyOf
 * and looks inside `{ data: ... }`-style envelopes so a wrapper object doesn't
 * hide an array. Returns null when the spec gives no usable signal, in which
 * case the caller falls back to path/summary shape.
 */
export function schemaIsCollection(
  schema: Record<string, unknown> | undefined,
  depth = 0
): CollectionVerdict {
  if (!schema || depth > 4) return null;
  if (schema.type === "array") return { kind: "collection" };

  if (schema.type === "object") {
    const props = (schema.properties || {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const key of ENVELOPE_KEYS) {
      const child = props[key];
      if (!child) continue;
      const inner = schemaIsCollection(child, depth + 1);
      if (inner?.kind === "collection") {
        return { kind: "collection", envelope: key };
      }
      return { kind: "ambiguous-envelope", envelope: key };
    }

    // A schema with exactly one property is drawn purely to wrap that
    // property — Procore's older v1.0 endpoints envelope under the plural
    // resource name (`{ exchange_rates: [...] }`) rather than a generic
    // `data`/`items` key, which the fixed allowlist above can't anticipate.
    const propNames = Object.keys(props);
    if (propNames.length === 1) {
      const inner = schemaIsCollection(props[propNames[0]], depth + 1);
      if (inner?.kind === "collection") {
        return { kind: "collection", envelope: propNames[0] };
      }
    }
    return { kind: "single" };
  }

  // allOf composes by intersection -- the real response is the MERGE of every
  // branch's properties, not "does any branch match" (that's what oneOf/anyOf
  // mean). Treating them the same let one branch's incidental extra field
  // decide the shape of the whole merged object: a TimecardEntry response
  // allOf'd with `{ automatically_split_timecard_entries: [...] }` (an
  // optional extra, only present under overtime management) is still a
  // single TimecardEntry, not a list, once every branch's fields are merged.
  const allOfBranches = schema.allOf as Record<string, unknown>[] | undefined;
  if (Array.isArray(allOfBranches)) {
    const merged: Record<string, unknown> = {};
    let anyBareArray = false;
    for (const branch of allOfBranches) {
      if (branch.type === "array") anyBareArray = true;
      else if (branch.type === "object" && branch.properties) {
        Object.assign(merged, branch.properties as Record<string, unknown>);
      }
    }
    if (anyBareArray) return { kind: "collection" };
    return schemaIsCollection({ type: "object", properties: merged }, depth + 1);
  }

  // oneOf/anyOf describe genuine alternation, so any branch drawn as a
  // collection means the response can genuinely be one.
  for (const key of ["oneOf", "anyOf"] as const) {
    const branches = schema[key] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(branches)) continue;
    let fallback: CollectionVerdict = null;
    for (const branch of branches) {
      const verdict = schemaIsCollection(branch, depth + 1);
      if (verdict?.kind === "collection") return verdict;
      if (verdict && !fallback) fallback = verdict;
    }
    if (fallback) return fallback;
  }
  return null;
}

/** Path ends in a literal segment (a collection) rather than an `{id}`. */
function pathEndsInCollection(path: string): boolean {
  const last = path.split("/").filter(Boolean).pop() || "";
  return !last.startsWith("{");
}

const LIST_SUMMARY =
  /^(list|lists|index|search|get all|gets all|retrieve all|retrieves all|return all|returns all|show all|shows all|return a list|returns a list|get a list|gets a list|get the list)\b/i;

/**
 * Explicit collection language inside the operation's prose description, for
 * endpoints whose *summary* is terse ("Get Layers") but whose description
 * spells out the plural intent ("Returns all accessible layers ..."). Unlike
 * LIST_SUMMARY this only needs to match anywhere near the start of the
 * description, not anchor the whole string.
 */
const LIST_DESCRIPTION =
  /\b(returns?|retrieves?|gets?|lists?|shows?)\s+(all|the collection of|a collection of|the full (?:list|set) of|a (?:full )?list of)\b/i;

export function detectReturnsCollection(
  operation: OASOperation,
  method: string,
  path: string,
  /** The endpoint accepts page/per_page — only collections are paginated. */
  hasPagination: boolean
): { returnsCollection: boolean; collectionEnvelope?: string } {
  if (method !== "get") return { returnsCollection: false };

  const responses = (operation.responses || {}) as Record<
    string,
    { content?: Record<string, { schema?: Record<string, unknown> }> }
  >;
  const ok = responses["200"] || responses["201"];
  // Prefer application/json, but Procore occasionally documents a response
  // only under a wildcard content type (`*/*`) — falling through to
  // `undefined` there discarded a real (if uninformative) schema and forced
  // every such endpoint through the no-schema path below.
  const content = ok?.content;
  const schema =
    content?.["application/json"]?.schema ??
    (content ? Object.values(content)[0]?.schema : undefined);

  // A scalar or binary payload (a raw CSV/PDF/file download, `type: "string",
  // format: "binary"`) can never be "a JSON array of records", no matter what
  // pagination params or list language the operation declares -- those are
  // often just copied from a sibling JSON-list endpoint's parameter template.
  // This is unconditional, unlike the softer `single` verdict below.
  const scalarTypes = new Set(["string", "number", "integer", "boolean"]);
  if (schema && typeof schema.type === "string" && scalarTypes.has(schema.type)) {
    return { returnsCollection: false };
  }

  const verdict = schemaIsCollection(schema);
  if (verdict?.kind === "collection") {
    return { returnsCollection: true, collectionEnvelope: verdict.envelope };
  }

  const description = operation.description || "";
  const textSignalsList =
    LIST_SUMMARY.test(operation.summary || "") ||
    LIST_DESCRIPTION.test(description.slice(0, 200));
  const collectionPath = pathEndsInCollection(path);
  /**
   * On a non-{id} path (`.../purchase_orders/{id}/related_documents`), the
   * trailing segment already names a real sub-collection, so declared
   * pagination alone is trustworthy -- either signal suffices. On an
   * {id}-shaped path, that same trust is exactly what produced two false
   * positives (show_company_vendor, show_recycled_checklist_template):
   * Procore's spec sometimes copies page/per_page onto a genuine
   * show-by-id endpoint with no textual list signal behind it. So there,
   * pagination is corroborating evidence, not sufficient on its own -- it
   * must be paired with explicit list language (which is what makes
   * accessible_layers/{context_type_id} correctly read as a collection: its
   * trailing segment looks like an id but is actually a filter, and its own
   * description says "Retrieve all layers ...").
   */
  const overridesDefiniteSingle = collectionPath
    ? hasPagination || textSignalsList
    : hasPagination && textSignalsList;

  if (verdict?.kind === "ambiguous-envelope") {
    // The spec draws one enveloped element, but v2 list endpoints are often
    // documented that way.
    return overridesDefiniteSingle
      ? { returnsCollection: true, collectionEnvelope: verdict.envelope }
      : { returnsCollection: false };
  }
  if (verdict?.kind === "single") {
    // A definite object schema usually means a genuine singleton — but
    // Procore sometimes documents only the array *item's* shape (a "Show All
    // ..." endpoint whose schema is one Batch object, not an array of them).
    // Only the strongest signals overturn it, to avoid reintroducing
    // pagination on truly-singleton endpoints.
    return { returnsCollection: overridesDefiniteSingle };
  }

  // No usable schema at all -- the weakest-evidence case. Trust the same
  // signal combination as above.
  return { returnsCollection: overridesDefiniteSingle };
}
