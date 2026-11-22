/**
 * Verifies the committed tools manifest and the descriptions rendered from it.
 * Encodes the invariants behind the Glama TDQS/coherence fixes so a spec
 * refresh or builder change cannot quietly reintroduce them:
 *
 *   - names are unique, <= 64 chars, snake_case, and never end on a stranded
 *     function word ("..._for_a")
 *   - a list-named GET is never described as fetching a single record
 *   - a recycle tool never claims the delete is permanent
 *   - a non-create POST is never described as creating a record
 *   - no description leaks an action verb into the resource label
 *     ("the retrieves the status")
 *   - a bulk/batch endpoint is never listed as a "version sibling" of a
 *     single-record one, and vice versa
 *   - no name is a bare HTTP method word ("post_company_role") or an opaque
 *     numeric-suffix collision fallback ("_2")
 *   - no description holds an unclosed markdown table (an even number of
 *     "|" per row) or a mid-word "..." truncation artifact
 *
 * Run: npm test (tsx scripts/verify-manifest.ts)
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildDescription } from "../src/tools/description-builder.js";
import { buildTitle } from "../src/tools/annotation-builder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(__dirname, "..", "data", "tools-manifest.json");

interface Entry {
  toolName: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  category: string;
  module: string;
  version: string;
  params: Array<{ name: string; required: boolean; source?: string }>;
  bodyWrapper?: string;
  returnsCollection?: boolean;
  collectionEnvelope?: string;
  deprecated?: boolean;
  versionSiblings?: Array<{ toolName: string; version: string }>;
}

const BULK_PATH_ACTION = /\/(bulk|batch)(_\w+)?$/;

const LIST_NAME =
  /^(list|lists|index|get_all|gets_all|retrieve_all|retrieves_all|return_a_list|returns_a_list|show_all|shows_all|get_a_list|search)/;
const CREATE_NAME =
  /^(create|creates|add|adds|new|register|attach|upload|import|find_or_create|bulk_create|batch_create|post|draft)/;
// "by"/"from"/"in" are excluded: field names like created_by and
// received_from legitimately end on them.
const DANGLING_TAIL = /_(a|an|the|of|for|to|with|and|or|that|its|as|when)$/;
// "get_"/"delete_" are natural English verbs and legitimately common; only
// "post"/"patch"/"put" as a bare leading word are the raw-HTTP-method
// leftovers this check exists for.
const HTTP_VERB_NAME = /^(post|patch|put)_/;
const NUMERIC_SUFFIX = /_\d+$/;
const VERSIONED_SUFFIX = /_v\d+_\d+$/;
const VERB_LEAK =
  /\b(the|a|an) (retrieves|returns|gets|lists|shows|recycles|creates|updates|deletes|verifies|fetches|checks|it) /;
// "an" agreeing with a consonant-initial word inserted before the resource
// noun ("Creates an new X", "Retrieves an single X") -- the article must
// agree with the inserted adjective, not with whatever the resource label
// starts with.
const BAD_AN = /\ban (new|single|recycled|previously)\b/i;
// A GET whose OWN description opens with "Creates"/"Create" is a genuine
// Procore spec error (unlike a PATCH/PUT upsert legitimately worded that
// way); generate-tools-manifest.ts should have cleared it to force synthesis.
const GET_DESCRIBED_AS_CREATE = /^creates?\s+/i;

const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

const manifest: Entry[] = JSON.parse(readFileSync(MANIFEST, "utf8"));
check(manifest.length > 2500, `manifest holds ${manifest.length} tools; expected > 2500`);

const byToolName = new Map(manifest.map((e) => [e.toolName, e]));
for (const e of manifest) {
  for (const sib of e.versionSiblings || []) {
    const peer = byToolName.get(sib.toolName);
    if (!peer) continue;
    check(
      BULK_PATH_ACTION.test(e.path) === BULK_PATH_ACTION.test(peer.path),
      `version-sibling pairing spans a bulk/single-record mismatch: ${e.toolName} <-> ${sib.toolName}`
    );
  }
}

const seen = new Set<string>();
for (const e of manifest) {
  const n = e.toolName;
  check(!seen.has(n), `duplicate tool name: ${n}`);
  seen.add(n);
  check(n.length <= 64, `name exceeds 64 chars: ${n}`);
  check(/^[a-z0-9_]+$/.test(n), `name is not snake_case: ${n}`);
  check(!DANGLING_TAIL.test(n), `name ends on a stranded function word: ${n}`);
  check(!HTTP_VERB_NAME.test(n), `name is a bare HTTP method word: ${n}`);
  check(
    !/(^|_)rest_v\d|(^|_)rest$/.test(n),
    `name carries a summary version annotation ("REST v2.0") instead of the path version: ${n}`
  );
  check(
    !(NUMERIC_SUFFIX.test(n) && !VERSIONED_SUFFIX.test(n)),
    `name falls back to an opaque numeric collision suffix: ${n}`
  );
  check(buildTitle(e.summary, e.deprecated).length > 0, `empty title: ${n}`);
}

for (const e of manifest) {
  const d = buildDescription(e);
  const n = e.toolName;

  check(d.length > 100 && d.length <= 2048, `description length out of range: ${n}`);
  check(!VERB_LEAK.test(d), `verb leaked into resource label: ${n}`);
  check(!BAD_AN.test(d), `"an" misagrees with a consonant-initial word: ${n}`);
  check(
    !(e.method === "GET" && GET_DESCRIBED_AS_CREATE.test(e.description.trim())),
    `GET tool's own OAS description opens with Creates/Create: ${n}`
  );
  // Procore's own prose can legitimately contain "..." (e.g. as JSON example
  // syntax, `[<id>, ...]`), so the marker itself isn't the signal -- three
  // dots directly against a following letter, with no space, is: that's a
  // hard character-count cut through the middle of a word.
  check(!/\.\.\.[a-z]/i.test(d), `description has a mid-word truncation artifact: ${n}`);

  if (e.method === "GET" && LIST_NAME.test(n)) {
    check(
      !/Retrieves a single\b|Returns a single JSON object describing\b/.test(d),
      `list-named GET described as a single-record fetch: ${n}`
    );
  }
  if (/recycl/.test(n)) {
    check(
      !/cannot be undone|Permanently removes/.test(d),
      `recycle tool claims a permanent delete: ${n}`
    );
  }
  if (e.method === "POST" && !CREATE_NAME.test(n)) {
    check(
      !d.startsWith("Creates a new"),
      `non-create POST described as creating a record: ${n}`
    );
  }
  if (e.returnsCollection && e.collectionEnvelope) {
    check(
      d.includes(`"${e.collectionEnvelope}" key`),
      `enveloped collection missing envelope note: ${n}`
    );
  }
}

if (failures.length > 0) {
  console.error(`Manifest verification FAILED (${failures.length} problem(s)):`);
  for (const f of failures.slice(0, 40)) console.error(`  - ${f}`);
  if (failures.length > 40) console.error(`  ... and ${failures.length - 40} more`);
  process.exit(1);
}
console.log(`Manifest verification passed: ${manifest.length} tools, all invariants hold.`);
