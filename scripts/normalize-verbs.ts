/**
 * Normalizes the leading verb of a generated tool name onto a consistent
 * verb_noun convention.
 *
 * Procore's operation titles use whatever verb the doc author reached for --
 * "List RFIs", "Show RFI", "Get All Equipment", "Retrieve Note", "Fetch
 * Attachment" -- so the generated surface mixed list/get/show/return/
 * retrieve/fetch for what are, semantically, two operations: read-many and
 * read-one. Agents pick tools by name, and a surface where the same action
 * wears six different verbs makes that guesswork.
 *
 * Two rules, both meaning-preserving:
 *
 *   1. READS (GET only). Any of the read synonyms collapses to `list_` when
 *      the endpoint genuinely returns a collection and `get_` when it does
 *      not. The verdict comes from `returnsCollection` -- the same
 *      schema-derived signal the description uses -- so the name is correct
 *      by construction rather than inherited from prose. This also repairs
 *      names that were already actively wrong (a `list_*` tool returning one
 *      record, a `get_all_*` tool returning a collection).
 *
 *   2. THIRD PERSON -> IMPERATIVE. "Creates"/"Updates"/"Deletes" are the same
 *      verb as "Create"/"Update"/"Delete", just conjugated differently by the
 *      doc author. And on a DELETE, "destroy" is a plain synonym of "delete".
 *
 * Everything else is left alone on purpose. A verb that names a DISTINCT
 * action -- reorder, recycle, restore, sync, send, export, close, approve,
 * assign, add/remove (association semantics), and the rest -- must survive,
 * because four prior releases went into making sure a tool's name never
 * claims semantics its endpoint does not have. Forcing `reorder_company_role`
 * to `create_company_role` for the sake of a uniform prefix would reintroduce
 * exactly that bug.
 */
import { truncateToolName } from "./manifest/naming.js";

/** Verbs that mean "read" and nothing more; the collection/single split is
 *  decided by data, not by which of these the author happened to type. */
const READ_SYNONYMS = new Set([
  "list", "lists", "index", "show", "shows", "get", "gets", "retrieve",
  "retrieves", "fetch", "fetches", "return", "returns", "view", "views",
]);

/** Conjugation variants of a verb that is otherwise already canonical. */
const THIRD_PERSON: Record<string, string> = {
  creates: "create",
  updates: "update",
  deletes: "delete",
  adds: "add",
  removes: "remove",
  recycles: "recycle",
  restores: "restore",
  verifies: "verify",
  syncs: "sync",
  sets: "set",
  moves: "move",
  sends: "send",
  clones: "clone",
  toggles: "toggle",
  makes: "make",
  destroys: "destroy",
  gets: "get",
};

/** Lead-in words a canonical read verb already implies. */
const READ_FILLER = new Set(["a", "an", "the", "list", "of"]);

export interface VerbNormalizable {
  toolName: string;
  method: string;
  returnsCollection?: boolean;
}

export function normalizeToolVerb(entry: VerbNormalizable): string {
  const tokens = entry.toolName.split("_");
  if (tokens.length === 0) return entry.toolName;
  const verb = tokens[0];

  if (entry.method === "GET" && READ_SYNONYMS.has(verb)) {
    const canonical = entry.returnsCollection ? "list" : "get";
    tokens[0] = canonical;
    // Procore's read titles carry lead-in filler the canonical verb already
    // implies: "Return a list of all Submittals" would otherwise normalize
    // to the stuttering `list_a_list_of_all_submittals`. Strip that run --
    // but never the final token, and keep "all" on a single-record read,
    // where it describes the field set rather than a row count
    // (`get_all_properties_for_a_resource` returns every property of one
    // record).
    while (
      tokens.length > 2 &&
      (READ_FILLER.has(tokens[1]) || (canonical === "list" && tokens[1] === "all"))
    ) {
      tokens.splice(1, 1);
    }
    return truncateToolName(tokens.join("_"));
  }

  // "destroy" is only ever a plain hard delete in this spec; association
  // removals are named remove_*/unassign_*/disassociate_* and are preserved.
  if (entry.method === "DELETE" && (verb === "destroy" || verb === "destroys")) {
    tokens[0] = "delete";
    return truncateToolName(tokens.join("_"));
  }

  const imperative = THIRD_PERSON[verb];
  if (imperative) {
    tokens[0] = imperative;
    return truncateToolName(tokens.join("_"));
  }

  return entry.toolName;
}
