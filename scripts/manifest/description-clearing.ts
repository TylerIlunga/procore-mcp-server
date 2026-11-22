/**
 * The two narrow cases where Procore's own OAS description text is
 * untrustworthy. Both clear the inherited `description` so the tool falls
 * back to its own summary-driven synthesis at run time.
 */
import { realPathSegments } from "./path-segments.js";
import type { ToolManifestEntry } from "./types.js";

/** True when `longSegs` is `shortSegs` with one or more real segments
 *  appended -- the shape a sub-resource action takes off its base resource
 *  (`signature_requests` -> `signature_requests/{id}/signature`), as opposed
 *  to a scope variant that inserts a segment in the middle
 *  (`workflows/presets` -> `projects/{id}/workflows/presets`), which is a
 *  legitimate case for sharing one description. */
function isPathPrefixExtension(shortSegs: string[], longSegs: string[]): boolean {
  if (longSegs.length <= shortSegs.length) return false;
  return shortSegs.every((seg, i) => seg === longSegs[i]);
}

/** A GET whose own OAS description opens with "Creates"/"Create" is a
 *  genuine spec error, not a legitimate upsert framing (unlike PATCH/PUT,
 *  where "Creates or updates X" accurately describes a real upsert) --
 *  e.g. the GET .../export endpoint whose description reads "Creates a
 *  email communication on a given project". Clearing it forces the
 *  method-aware synthesized purpose instead of repeating Procore's mistake. */
const CREATE_LEAD = /^creates?\s+/i;

export function clearGetDescribedAsCreate(manifest: ToolManifestEntry[]): void {
  for (const e of manifest) {
    if (e.method === "GET" && CREATE_LEAD.test(e.description.trim())) {
      e.description = "";
    }
  }
}

/**
 * Procore's own OAS text is occasionally copy-pasted onto a sub-resource
 * action without updating it for the new operation -- both
 * `signature_requests` (create the request) and
 * `signature_requests/{id}/signature` (add a signature to an existing
 * request) carry the identical description "Creates a Inspection Item
 * Signature Request for a specified Inspection." Trusting that inherited
 * text over the resource-aware synthesized purpose actively misdescribes
 * the sub-action. Rather than guess which of a pair owns the text
 * correctly (Procore isn't always consistent about which one dragged it
 * from the other), this clears it from both, so each falls back to its own
 * summary-driven synthesis.
 */
export function clearMisappliedDescriptions(manifest: ToolManifestEntry[]): void {
  const groups = new Map<string, ToolManifestEntry[]>();
  for (const e of manifest) {
    const text = e.description.trim();
    if (text.length < 30) continue;
    const key = `${e.method}::${text}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }

  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    const segs = entries.map((e) => realPathSegments(e.path));
    for (let i = 0; i < entries.length; i++) {
      for (let j = 0; j < entries.length; j++) {
        if (i === j) continue;
        if (isPathPrefixExtension(segs[i], segs[j])) {
          entries[i].description = "";
          entries[j].description = "";
        }
      }
    }
  }
}
