/**
 * Name-collision resolution: meaning-bearing suffix stages, rerun until
 * stable, then a numeric fallback that guarantees uniqueness.
 */
import { withSuffix, collapseStutter } from "./naming.js";
import type { ToolManifestEntry } from "./types.js";

/** "project" / "company" / "root" — the scope a path is nested under. */
function scopeOf(path: string): string {
  if (path.includes("/projects/{")) return "project";
  if (path.includes("/companies/{")) return "company";
  return "root";
}

/**
 * The literal path segment that separates this entry from its identically
 * named peers — e.g. the five "Check PDF generation status" endpoints differ
 * only by parent resource (prime_change_orders, commitment_contracts, ...).
 * A named suffix beats the opaque `_2`/`_4` numbering it replaces.
 */
function distinguishingSegment(
  e: ToolManifestEntry,
  peers: ToolManifestEntry[]
): string | null {
  const tokenize = (p: string) =>
    p
      .replace(/\/rest\/v[\d.]+\//, "/")
      .split("/")
      .filter((s) => s && !s.startsWith("{") && s !== "companies" && s !== "projects");
  const mine = tokenize(e.path);
  const others = new Set(
    peers.filter((x) => x !== e).flatMap((x) => tokenize(x.path))
  );
  const distinct = mine.filter((s) => !others.has(s));
  if (distinct.length === 0) return null;
  // Prefer the most specific (last) segment that isn't already part of the
  // name — `list_accepted_weather_conditions` should gain `_daily_logs`, not
  // a redundant `_weather_conditions`.
  const fresh = distinct.filter((s) => !e.toolName.includes(s.toLowerCase()));
  const pick = (fresh.length > 0 ? fresh : distinct).pop()!;
  return pick.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

/** The `{param}` names a path declares, in order. */
function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((mm) => mm[1]);
}

/** Rename the still-colliding members of a family with one disambiguator. */
function applyStage(
  entries: ToolManifestEntry[],
  rename: (e: ToolManifestEntry, peers: ToolManifestEntry[]) => string | null
): void {
  const byName = new Map<string, ToolManifestEntry[]>();
  for (const e of entries) {
    const bucket = byName.get(e.toolName);
    if (bucket) bucket.push(e);
    else byName.set(e.toolName, [e]);
  }
  for (const group of byName.values()) {
    if (group.length <= 1) continue;
    for (const e of group) {
      const next = rename(e, group);
      if (next) e.toolName = next;
    }
  }
}

/**
 * One pass of the four disambiguation stages over whatever name collisions
 * currently exist. Renaming a member (stage 1's scope suffix, most often)
 * can create a *new* collision with an entry that was never part of the
 * original group (`create_timecard_entry` + "(Project)" in one sibling's own
 * summary already produced `create_timecard_entry_project` before the other
 * sibling's scope suffix independently produced the same string) --
 * `resolveCollisions` calls this repeatedly so that new collision is
 * re-examined by the same stages rather than falling straight to a bare
 * numeric suffix.
 */
function disambiguationPass(manifest: ToolManifestEntry[]): void {
  const nameToEntries = new Map<string, ToolManifestEntry[]>();
  for (const e of manifest) {
    if (!nameToEntries.has(e.toolName)) nameToEntries.set(e.toolName, []);
    nameToEntries.get(e.toolName)!.push(e);
  }

  for (const [name, entries] of nameToEntries) {
    if (entries.length <= 1) continue;

    // Stage 1: company/project scope, only when the family actually spans
    // scopes — a suffix every member shares distinguishes nothing. The
    // scopeless member matters just as much as the scoped ones: a bare
    // `/tools` and a `/projects/{id}/tools` sharing a name because the
    // summary already says "project" left the scopeless one with no
    // suffix at all and nothing to tell it apart from its scoped sibling.
    if (new Set(entries.map((e) => scopeOf(e.path))).size > 1) {
      for (const e of entries) {
        const scope = scopeOf(e.path);
        if (scope !== "root" && !name.includes(scope)) {
          e.toolName = withSuffix(name, scope);
        } else if (scope === "root" && !name.includes("unscoped")) {
          e.toolName = withSuffix(name, "unscoped");
        }
      }
    }

    // Stage 2: API version, only where the colliding peers differ on it.
    applyStage(entries, (e, peers) => {
      if (new Set(peers.map((p) => p.version)).size <= 1) return null;
      const vSuffix = e.version.replace(/\./g, "_");
      return e.toolName.endsWith(vSuffix) ? null : withSuffix(e.toolName, vSuffix);
    });

    // Stage 3: the path segment that separates this entry from its peers.
    applyStage(entries, (e, peers) => {
      const segment = distinguishingSegment(e, peers);
      return segment ? collapseStutter(withSuffix(e.toolName, segment)) : null;
    });

    // Stage 3b: parent scope. Two endpoints can share every literal segment
    // and differ only by whether a parent id narrows the collection --
    // `/direct_costs/{direct_cost_id}/line_items` (one cost's lines) beside
    // `/direct_costs/line_items` (every line in the project). Stage 3 finds
    // nothing to grab because the literal segments are identical, so name the
    // parent whose id does the narrowing.
    applyStage(entries, (e, peers) => {
      const mine = pathParamNames(e.path);
      const others = new Set(
        peers.filter((p) => p !== e).flatMap((p) => pathParamNames(p.path))
      );
      const unique = mine.filter((n) => !others.has(n));
      if (unique.length === 0) return null;
      const parent = unique[unique.length - 1].replace(/_id$/, "");
      return collapseStutter(withSuffix(e.toolName, "for_" + parent));
    });

    // Stage 4: HTTP method, for PATCH/PUT twins on the same path.
    applyStage(entries, (e, peers) => {
      if (new Set(peers.map((p) => p.method)).size <= 1) return null;
      return withSuffix(e.toolName, e.method.toLowerCase());
    });
  }
}

/**
 * Disambiguate identically named tools with meaning-bearing suffixes, in
 * order of how much signal each carries: scope (company vs project), API
 * version (only when peers actually differ on it), then the path segment
 * that tells the endpoints apart. Numbers are the last resort — an agent can
 * choose between `..._prime_change_orders` and `..._commitment_contracts`,
 * but not between `_2` and `_4`.
 */
export function resolveCollisions(manifest: ToolManifestEntry[]): void {
  // Run until a pass produces no renames (a new collision the previous pass
  // just created gets caught by the next one) or a small safety cap is hit --
  // real cascades in this dataset are one level deep, so this is generous.
  for (let i = 0; i < 4; i++) {
    const before = manifest.map((e) => e.toolName).join("\0");
    disambiguationPass(manifest);
    if (manifest.map((e) => e.toolName).join("\0") === before) break;
  }

  // Final pass: guarantee uniqueness. Distinct endpoints can still collapse to
  // the same name when their summaries match and every structural suffix is
  // already taken, so keep numbering until the name is genuinely free.
  const taken = new Set<string>();
  for (const entry of manifest) {
    if (!taken.has(entry.toolName)) {
      taken.add(entry.toolName);
      continue;
    }
    let n = 2;
    let candidate = withSuffix(entry.toolName, String(n));
    while (taken.has(candidate)) {
      n++;
      candidate = withSuffix(entry.toolName, String(n));
    }
    entry.toolName = candidate;
    taken.add(candidate);
  }
}
