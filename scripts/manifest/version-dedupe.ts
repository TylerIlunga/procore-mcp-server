import type { ToolManifestEntry } from "./types.js";

/** Replace `/rest/vX.Y/` with `/rest/vX/` so different versions of the same
 *  endpoint hash to the same key. */
function normalizeVersionInPath(path: string): string {
  return path.replace(/\/rest\/v\d+(?:\.\d+)?\//, "/rest/vX/");
}

function compareVersions(a: string, b: string): number {
  const pa = /v(\d+)\.(\d+)/.exec(a);
  const pb = /v(\d+)\.(\d+)/.exec(b);
  const [aMaj, aMin] = pa ? [parseInt(pa[1], 10), parseInt(pa[2], 10)] : [0, 0];
  const [bMaj, bMin] = pb ? [parseInt(pb[1], 10), parseInt(pb[2], 10)] : [0, 0];
  if (aMaj !== bMaj) return aMaj - bMaj;
  return aMin - bMin;
}

/**
 * Drop deprecated older-version duplicates of the same endpoint. Two entries
 * are duplicates when they share an HTTP method and produce the same path
 * after stripping the API version segment. Only one survives — the highest
 * version. Distinct paths under different versions are preserved.
 *
 * Removed endpoints are still reachable via `procore_api_call`; they just
 * stop being individual MCP tools to keep the surface coherent.
 */
export function dedupeByVersionedPath(manifest: ToolManifestEntry[]): ToolManifestEntry[] {
  const groups = new Map<string, ToolManifestEntry[]>();
  for (const e of manifest) {
    const key = `${e.method} ${normalizeVersionInPath(e.path)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }

  const kept: ToolManifestEntry[] = [];
  let dropped = 0;
  for (const entries of groups.values()) {
    if (entries.length === 1) {
      kept.push(entries[0]);
      continue;
    }
    const sorted = [...entries].sort((a, b) => compareVersions(b.version, a.version));
    kept.push(sorted[0]);
    dropped += entries.length - 1;
  }

  if (dropped > 0) {
    console.log(`Deduplicated: dropped ${dropped} older-version duplicate(s).`);
  }
  return kept;
}
