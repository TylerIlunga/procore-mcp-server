/**
 * Cross-version sibling grouping: tools that carry out the same operation at
 * different Procore API versions under different paths, so each description
 * can name the other(s).
 */
import { realPathSegments } from "./path-segments.js";
import type { ToolManifestEntry } from "./types.js";

/** Crude singularize-and-strip-scope key: "List Weather Logs" and "Show
 *  Weather Log" -> "list weather log" / "show weather log". Good enough to
 *  group same-operation tools across versions; a false grouping only costs
 *  an extra disambiguation sentence, not a behavioral bug. */
function versionGroupKey(method: string, summary: string): string {
  const normalized = summary
    .toLowerCase()
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, "")
    // Filler articles: "Create Coordination Issue" and "Create a
    // coordination issue" name the same operation, but only one has the
    // article -- strip it so the two keys match.
    .replace(/\b(a|an|the)\b\s*/g, "")
    .replace(/s$/, "");
  return `${method}::${normalized}`;
}

/** A trailing `/bulk_update`, `/bulk_create`, `/batch_delete`, etc. changes
 *  an operation from single-record to many-at-once -- a fundamentally
 *  different call, not a version bump of the single-record one. */
const BULK_PATH_ACTION = /\/(bulk|batch)(_\w+)?$/;

/** True if every segment of the shorter list appears in the longer list, in
 *  the same relative order (not necessarily contiguous) — the shape Procore
 *  version bumps actually take, e.g. inserting a `daily_logs` segment. A
 *  summary like "Create Attachment" is reused across many unrelated parent
 *  resources (witness statements, checklist lists, incident actions, ...),
 *  and those don't share this structure even though the summary text does. */
function pathsAreSameResource(pathA: string, pathB: string): boolean {
  if (BULK_PATH_ACTION.test(pathA) !== BULK_PATH_ACTION.test(pathB)) {
    return false;
  }
  const a = realPathSegments(pathA);
  const b = realPathSegments(pathB);
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  for (const segment of longer) {
    if (segment === shorter[i]) i++;
    if (i === shorter.length) return true;
  }
  return shorter.length === 0;
}

/**
 * Records, on each entry, the sibling tools that carry out the same
 * operation at a different Procore API version — so the description can
 * name them instead of leaving two identically-worded tools indistinguishable.
 */
export function attachVersionSiblings(manifest: ToolManifestEntry[]): void {
  const groups = new Map<string, ToolManifestEntry[]>();
  for (const e of manifest) {
    const key = versionGroupKey(e.method, e.summary);
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }

  for (const entries of groups.values()) {
    if (new Set(entries.map((e) => e.version)).size < 2) continue;
    for (const e of entries) {
      const versionPeers = entries.filter(
        (peer) =>
          peer !== e &&
          peer.version !== e.version &&
          pathsAreSameResource(e.path, peer.path)
      );
      if (versionPeers.length === 0) continue;
      e.versionSiblings = versionPeers.map((peer) => ({
        toolName: peer.toolName,
        version: peer.version,
      }));
    }
  }
}
