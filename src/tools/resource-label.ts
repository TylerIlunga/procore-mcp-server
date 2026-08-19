/**
 * Derives the human-readable resource an endpoint acts on.
 *
 * Descriptions previously used the OAS tag's module name as the resource,
 * which is a *category*, not a thing: `show_rounding_configuration` read
 * "a specific Field Productivity records" and `delete_incident_alert_recipient`
 * claimed to delete "Incidents". Procore's operation summaries name the actual
 * resource ("Delete Incident Alert Recipient"), so we strip the leading action
 * verb from the summary and fall back to the path's terminal collection
 * segment when that yields nothing usable.
 */

export interface ResourceLabel {
  singular: string;
  plural: string;
}

/** Longest-first so "bulk create" wins over "create". */
const ACTION_VERBS = [
  "get a list of", "get list of", "returns a list of", "return a list of",
  "returns the list of", "return the list of", "list of", "get all", "show all",
  "retrieve all", "retrieves all", "return all", "gets all", "returns all",
  "it fetches", "it retrieves", "it gets", "it returns",
  "bulk create", "bulk update", "bulk delete", "bulk destroy", "bulk remove",
  "bulk retrieve", "bulk activation", "bulk deactivation", "batch update",
  "batch get", "find or create", "creates or updates", "create or find",
  "respond to", "belonging to",
  "list", "index", "show", "get", "retrieve", "fetch", "create", "add",
  "update", "edit", "patch", "delete", "destroy", "remove", "sync", "restore",
  "send", "download", "upload", "export", "import", "view", "set", "move",
  "copy", "clone", "duplicate", "approve", "reject", "revoke", "disable",
  "enable", "deactivate", "reactivate", "close", "validate", "calculate",
  "generate", "find", "search", "check", "save", "assign", "unassign", "make",
  "toggle", "convert", "merge", "reorder", "initiate", "terminate", "restart",
  "refresh", "withdraw", "grant", "modify", "publish", "submit", "recycle",
  "verify", "consolidate", "reopen", "trigger", "perform", "mark", "link",
  "unlink", "preview", "recalculate", "resolve", "clones",
  "deletes", "creates", "updates", "shows", "lists", "gets", "adds", "removes",
  "retrieves", "fetches", "recycles", "verifies", "checks", "searches",
  "sends", "syncs", "saves", "assigns", "unassigns", "moves", "copies",
  "exports", "imports", "downloads", "uploads", "toggles", "converts",
  "merges", "reorders", "restores", "restarts", "refreshes", "terminates",
  "initiates", "generates", "calculates", "validates", "approves", "rejects",
  "closes", "publishes", "submits", "edits", "views", "makes", "finds",
  "destroys", "enables", "disables", "marks", "performs", "consolidates",
  "reopens", "triggers", "recalculates", "previews", "resolves", "links",
  "unlinks", "distribute", "distributes", "advance", "advances", "stop",
  "stops", "transition", "transitions", "returns", "return",
];

// "and"/"or" join compound verbs ("Close and Distribute a Submittal Log");
// treating them as filler lets the next pass strip the second verb too.
const LEADING_FILLER =
  /^(a|an|the|all|of|new|single|specific|for|to|on|in|from|with|by|within|at|if|whether|it|and|or)\s+/i;

/**
 * Acronym stems that should render uppercase. Stored singular; the plural is
 * always stem + "s", which keeps "rfis" inflecting to RFI/RFIs instead of
 * tripping the generic `-is$` rule and yielding "RFIS"/"RFISes".
 */
const ACRONYM_STEMS = new Set([
  "rfi", "rfq", "pco", "cor", "sov", "pdf", "csv", "xml", "json", "html",
  "url", "uri", "bim", "erp", "wbs", "api", "id", "uuid", "gps", "uom",
  "lov", "ui", "po", "mfa", "aemp", "qr", "sso", "ocr",
]);

/** Returns the acronym stem when `word` is that acronym, singular or plural. */
function acronymStem(word: string): string | null {
  const lower = word.toLowerCase();
  if (ACRONYM_STEMS.has(lower)) return lower;
  if (lower.endsWith("s") && ACRONYM_STEMS.has(lower.slice(0, -1))) {
    return lower.slice(0, -1);
  }
  return null;
}

const IRREGULAR_SINGULAR: Record<string, string> = {
  people: "person",
  children: "child",
  men: "man",
  women: "woman",
  criteria: "criterion",
  indices: "index",
  matrices: "matrix",
  analyses: "analysis",
  data: "data",
  metadata: "metadata",
};

const UNCOUNTABLE = new Set([
  "data", "metadata", "equipment", "information", "access", "status",
  "progress", "software", "media", "series", "manpower", "weather",
]);

function singularizeWord(word: string): string {
  const lower = word.toLowerCase();
  const stem = acronymStem(word);
  if (stem) return stem;
  if (IRREGULAR_SINGULAR[lower]) return IRREGULAR_SINGULAR[lower];
  if (UNCOUNTABLE.has(lower)) return word;
  if (/[^aeiou]ies$/i.test(word)) return word.slice(0, -3) + "y";
  if (/(ss|us|is)$/i.test(word)) return word;
  if (/(s|x|z|ch|sh)es$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word)) return word.slice(0, -1);
  return word;
}

function pluralizeWord(word: string): string {
  const lower = word.toLowerCase();
  const stem = acronymStem(word);
  if (stem) return stem + "s";
  if (UNCOUNTABLE.has(lower)) return word;
  if (singularizeWord(word).toLowerCase() !== lower) return word; // already plural
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  return word + "s";
}

/** Prepositions whose object postmodifies an earlier head noun. */
const POSTMODIFIER_PREPS = new Set(["of", "in"]);
const ALL_PREPS = new Set([
  "of", "in", "for", "to", "by", "with", "from", "at", "on", "within",
]);

/**
 * Inflect the head noun of a phrase.
 *
 * Usually that is the final word ("action plan items" -> "action plan item"),
 * but an of/in phrase postmodifies an earlier head: "points of contact"
 * singularizes to "point of contact", not "points of contacts". Words ending
 * in "-ed" are past participles rather than nouns, so they are left alone —
 * inflecting them produced the nonsense "enableds" and "closeds".
 */
function inflectHead(phrase: string, fn: (w: string) => string): string {
  const words = phrase.split(" ");
  if (words.length === 0) return phrase;

  let target = words.length - 1;
  const prepAt = words.findIndex((w) => ALL_PREPS.has(w.toLowerCase()));
  if (prepAt > 0 && POSTMODIFIER_PREPS.has(words[prepAt].toLowerCase())) {
    target = prepAt - 1;
  }

  const word = words[target];
  if (/ed$/i.test(word) || ALL_PREPS.has(word.toLowerCase())) return phrase;

  words[target] = fn(word);
  return words.join(" ");
}

/** Lowercase everything except acronyms, which keep an "RFI"/"RFIs" shape. */
export function applyCasing(phrase: string): string {
  return phrase
    .split(" ")
    .map((w) => {
      const stem = acronymStem(w);
      if (!stem) return w.toLowerCase();
      return w.toLowerCase() === stem ? stem.toUpperCase() : stem.toUpperCase() + "s";
    })
    .join(" ");
}

function stripLeadingAction(text: string): string {
  let out = text.trim();
  // Verbs and filler can stack: "Get a list of ...", "Create a new ...".
  for (let pass = 0; pass < 4; pass++) {
    const before = out;
    // "Bulk"/"Batch" modify whatever verb follows; drop them so the verb
    // itself is matched ("Bulk Transition Defects" -> "Defects").
    out = out.replace(/^(bulk|batch)\s+/i, "").trim();
    const lower = out.toLowerCase();
    for (const verb of ACTION_VERBS) {
      if (lower === verb) return "";
      if (lower.startsWith(verb + " ")) {
        out = out.slice(verb.length).trim();
        break;
      }
    }
    out = out.replace(LEADING_FILLER, "").trim();
    if (out === before) break;
  }
  return out;
}

/**
 * Trailing scope phrases ("for a Project", "in the specified Company").
 *
 * The determiner is mandatory. Without it this stripped at the first
 * preposition it saw, severing the resource's own name: "Timesheet To Budget
 * Configuration" collapsed to "Timesheet" (a different, real resource) and
 * "Tools Enabled For Workflows" to "Tools Enabled", which then pluralized to
 * the nonsense "enableds".
 */
const TRAILING_SCOPE =
  /\s+(for|in|from|within|on|at|by|to|of|belonging to|associated with|attached to)\s+(a|an|the|this|that|its|their|specified|given|current|all)\s+\S.*$/i;

/** Bare "... for Project" / "... in Company" — scope even without a determiner. */
const TRAILING_SCOPE_NOUN =
  /\s+(for|in|on|within|of|from)\s+(project|projects|company|companies|the\s+project|the\s+company)$/i;

/** Trailing relative or modal clauses ("that a bulk users command queued",
 *  "can be deleted by checking..."). These describe the resource; they are
 *  not part of its name. */
const TRAILING_CLAUSE =
  /\s+(that|which|who|whose|can|cannot|could|should|must|matching|using|based)\b.*$/i;

/** Manner phrases that describe how the call works, not what it acts on. */
const TRAILING_MANNER = /\s+(in bulk|in a single request|by id|by path)$/i;

function cleanSummary(summary: string): string {
  let out = summary
    .replace(/\s*\([^)]*\)\s*$/g, " ") // trailing "(Project)" / "(Company)"
    // Possessives: "Person's Assignment History" -> "Person Assignment
    // History". Stripping the apostrophe alone stranded a bare "s".
    .replace(/['’]s\b/gi, "")
    .replace(/[_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  out = stripLeadingAction(out);
  for (const pattern of [TRAILING_SCOPE, TRAILING_SCOPE_NOUN]) {
    const scoped = out.replace(pattern, "").trim();
    if (scoped.length >= 3) out = scoped;
  }
  for (const pattern of [TRAILING_CLAUSE, TRAILING_MANNER]) {
    const trimmed = out.replace(pattern, "").trim();
    if (trimmed.length >= 3) out = trimmed;
  }

  // Drop any remaining punctuation and cap runaway phrases.
  out = out.replace(/[^A-Za-z0-9&\s-]/g, " ").replace(/\s+/g, " ").trim();
  const words = out.split(" ").filter(Boolean);
  return words.slice(0, 8).join(" ");
}

/** Path segments that are actions, not resources. */
const PATH_ACTIONS = new Set([
  "refresh", "restore", "approve", "reject", "send", "sync", "validate",
  "enable", "disable", "deactivate", "reactivate", "export", "download",
  "revoke", "withdraw", "terminate", "restart", "close", "publish", "recover",
  "bulk_create", "bulk_update", "bulk_destroy", "bulk_delete", "destroy_collection",
  "search", "filter_options", "recycle", "recycled", "ids", "count", "counts",
]);

function resourceFromPath(path: string): string {
  const segments = path
    .replace(/\/rest\/v[\d.]+\//, "/")
    .split("/")
    .filter((s) => s && !s.startsWith("{"));

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (PATH_ACTIONS.has(seg)) continue;
    return seg.replace(/[-_]/g, " ").trim();
  }
  return "";
}

/**
 * Resolve the resource an operation acts on. `summary` is authoritative;
 * `path` is the fallback; `moduleName` is the last resort.
 */
export function deriveResource(
  summary: string,
  path: string,
  moduleName: string
): ResourceLabel {
  let base = cleanSummary(summary || "");

  if (base.replace(/\s/g, "").length < 3) {
    base = cleanSummary(resourceFromPath(path));
  }
  if (base.replace(/\s/g, "").length < 3) {
    base = (moduleName || "Procore record").replace(/[-_]/g, " ");
  }

  // Inflect first, then case — singularizing an already-uppercased acronym
  // would otherwise drop it back to lowercase. Collapse whitespace last:
  // stripping an inline "(s)" from a summary can leave a doubled space.
  const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
  return {
    singular: tidy(applyCasing(inflectHead(base,singularizeWord))),
    plural: tidy(applyCasing(inflectHead(base,pluralizeWord))),
  };
}

/** Indefinite article that reads correctly before the given phrase. */
export function articleFor(phrase: string): string {
  const first = phrase.trim().charAt(0).toLowerCase();
  return "aeiou".includes(first) ? "an" : "a";
}
