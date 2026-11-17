/**
 * Catalog generation caps Procore's prose with a trailing "...", which can
 * leave a sentence severed mid-clause. Roll back to the last full sentence so
 * the purpose line always reads as finished prose.
 */

/** Abbreviations whose period reads as a sentence end to a naive scan --
 *  "e.g. Smartsheet, OpenProject" isn't a sentence boundary, and treating it
 *  as one severed a markdown table mid-row. */
const ABBREVIATION_END = /\b(e\.g|i\.e|etc|vs|approx|no|cf|fig|vol|dr|mr|mrs|ms|jr|sr)\.$/i;

/** The last ". "/"! "/"? " in `body` that isn't a false boundary from an
 *  abbreviation, or -1 if none exists. */
function lastValidSentenceEnd(body: string): number {
  const boundary = /[.!?]\s/g;
  let match: RegExpExecArray | null;
  let best = -1;
  while ((match = boundary.exec(body))) {
    const idx = match.index;
    if (body[idx] === "." && ABBREVIATION_END.test(body.slice(0, idx + 1))) {
      continue;
    }
    best = idx;
  }
  return best;
}

export function trimToWholeSentence(text: string): string {
  if (!text.endsWith("...")) return text;
  const body = text.slice(0, -3);
  const lastStop = lastValidSentenceEnd(body);
  // Only roll back if a decent amount of prose survives.
  if (lastStop > 80) return body.slice(0, lastStop + 1);
  return body.trimEnd().replace(/[,;:]$/, "") + ".";
}
