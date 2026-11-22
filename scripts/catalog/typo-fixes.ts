/**
 * Spelling fixes for typos that ship in Procore's OAS prose. Tool names,
 * titles, and descriptions all derive from this text, so repair it at the
 * source. Each fix preserves a leading capital.
 */
const TYPO_FIXES: Array<[RegExp, string]> = [
  [/\basyncronous\b/gi, "asynchronous"],
  [/\bavailablility\b/gi, "availability"],
  [/\brecyled\b/gi, "recycled"],
  [/\bseperate\b/gi, "separate"],
  [/\boccured\b/gi, "occurred"],
  [/\bsucessfully\b/gi, "successfully"],
  [/\bdetete\b/gi, "delete"],
  [/\bupdats\b/gi, "updates"],
  [/\bassociat\b/gi, "associate"],
  // "Restored a deleted X" documents a restore endpoint in the past tense.
  [/^restored\b/i, "Restores"],
  // "Make a Tag from being Available to a Group" is a mangled negation of the
  // paired removal endpoint; the POST grants availability. Matches with or
  // without the article so the operation title is repaired too.
  [/\b(makes?)\s+((?:a|an)\s+)?(.+?)\s+from being available to\b/gi, "$1 $2$3 available to"],
  // A bare HTTP-method word leading the summary ("POST Company Role") is an
  // OAS authoring shortcut, not a natural-language title -- it produced tool
  // names like post_company_role/patch_company_role that read as raw HTTP
  // verbs instead of an action. GET/DELETE are already natural verbs, so
  // those two rules are pure casing normalization.
  [/^POST\s+/, "Create "],
  [/^PATCH\s+/, "Update "],
  [/^PUT\s+/, "Update "],
  [/^GET\s+/, "Get "],
  [/^DELETE\s+/, "Delete "],
];

export function fixTypos(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [pattern, replacement] of TYPO_FIXES) {
    // A replacer function makes "$1" literal, so rewrites that reference
    // capture groups must use the plain string form.
    if (/\$\d/.test(replacement)) {
      out = out.replace(pattern, replacement);
      continue;
    }
    out = out.replace(pattern, (match) =>
      match[0] === match[0].toUpperCase()
        ? replacement[0].toUpperCase() + replacement.slice(1)
        : replacement
    );
  }
  return out;
}
