/**
 * HTTP client invariants (src/api/client.ts): timeout, retry and refresh paths.
 * `fetch` is mocked and the backoff wait is replaced with an instant one, so
 * nothing touches the network or waits in real time. Run by `npm test`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { getRequestTimeoutMs } from "../src/api/request-timeout.js";
import type { ProcoreApiResponse } from "../src/api/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_PATH = join(tmpdir(), `procore-mcp-verify-client-${process.pid}.json`);
process.env.PROCORE_ENV = "sandbox";
process.env.PROCORE_CLIENT_ID = "test-id";
process.env.PROCORE_CLIENT_SECRET = "test-secret";
process.env.PROCORE_TOKEN_PATH = TOKEN_PATH; // never the real ~/.procore-mcp/tokens.json
process.env.PROCORE_GRANT_TYPE = "client_credentials"; // token comes from the mocked endpoint
delete process.env.PROCORE_REQUEST_TIMEOUT_MS;
delete process.env.PROCORE_COMPANY_ID;

const TOKEN_URL = "https://login-sandbox.procore.com/oauth/token";
const PATH = "/rest/v1.0/projects";

type ApiCall = { url: string; method?: string; authorization: string | null; signal?: AbortSignal | null };
type Step = () => Response;
let apiCalls: ApiCall[] = [];
let mints = 0;
let tokenSeq = 0;
let script: Step[] = [];

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url) === TOKEN_URL) {
    mints++;
    return json({ access_token: `tok-${++tokenSeq}`, token_type: "Bearer", expires_in: 5400 });
  }
  apiCalls.push({
    url: String(url),
    method: init?.method,
    authorization: new Headers(init?.headers).get("authorization"),
    signal: init?.signal,
  });
  const step = script.shift();
  if (!step) throw new Error(`unscripted API call #${apiCalls.length} to ${String(url)}`);
  return step();
}) as typeof fetch;

const json = (obj: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
const reply = (status: number, headers: Record<string, string> = {}): Step => () => json({ status }, status, headers);
/** What fetch rejects with when its `AbortSignal.timeout` fires. */
const timedOut: Step = () => {
  throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
};
const networkDown: Step = () => {
  throw new TypeError("fetch failed");
};

// Fresh client module (fresh rate-limit state) per case, with an instant, recording delay.
let delays: number[] = [];
let n = 0;
type Client = typeof import("../src/api/client.js");
async function load(): Promise<Client> {
  const client = (await import(`../src/api/client.js?case=${n++}`)) as Client;
  client.setDelayFn(async (ms) => {
    delays.push(ms);
  });
  apiCalls = [];
  delays = [];
  mints = 0;
  return client;
}
type Outcome = { value?: ProcoreApiResponse; error?: Error; leftover: number };
async function call(method: string, steps: Step[]): Promise<Outcome> {
  const client = await load();
  script = [...steps];
  // Settle before asserting so a leftover step is reported as such.
  const settled = await client.procoreApiCall({ method, path: PATH }).then(
    (value) => ({ value }),
    (error: Error) => ({ error })
  );
  return { ...settled, leftover: script.length };
}
function statusOf(r: Outcome): number {
  assert.ok(r.value, `expected a response, got: ${r.error?.message}`);
  return r.value.status;
}
function errorOf(r: Outcome): string {
  assert.ok(r.error, `expected an error, got status ${r.value?.status}`);
  return r.error.message;
}

async function main(): Promise<void> {
  // Warm the shared token cache so mint counts below measure refreshes only.
  await (await import("../src/auth/oauth.js")).getValidAccessToken();

  // ---- PROCORE_REQUEST_TIMEOUT_MS parsing ----
  assert.equal(getRequestTimeoutMs(), 30_000, "unset means the 30s default");
  for (const [raw, want] of [["", 30_000], ["  ", 30_000], ["5000", 5000], [" 1 ", 1], ["2147483647", 2147483647]] as const) {
    process.env.PROCORE_REQUEST_TIMEOUT_MS = raw;
    assert.equal(getRequestTimeoutMs(), want, `value ${JSON.stringify(raw)}`);
  }
  for (const bad of ["0", "-5", "abc", "1.5", "30s", "1e4", "0x10", "2147483648", "99999999999999999999"]) {
    process.env.PROCORE_REQUEST_TIMEOUT_MS = bad;
    assert.throws(() => getRequestTimeoutMs(), /PROCORE_REQUEST_TIMEOUT_MS must be a positive integer/, `"${bad}" must be rejected`);
  }

  // An invalid value fails the call itself, before any request goes out.
  process.env.PROCORE_REQUEST_TIMEOUT_MS = "soon";
  let r = await call("GET", [reply(200)]);
  assert.match(errorOf(r), /PROCORE_REQUEST_TIMEOUT_MS must be a positive integer/);
  assert.equal(apiCalls.length, 0, "no request with an invalid timeout");

  // ...and stops the server at startup with an ERROR: line on stderr, nothing on stdout.
  const child = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: ROOT,
    encoding: "utf8",
    // authorization_code + a missing token file: if validation regressed, startup
    // still exits (on "No Procore auth tokens") without touching the network.
    env: { ...process.env, PROCORE_REQUEST_TIMEOUT_MS: "-1", PROCORE_GRANT_TYPE: "authorization_code" },
  });
  assert.equal(child.status, 1, `startup must exit 1, stderr: ${child.stderr}`);
  assert.match(child.stderr, /^ERROR: PROCORE_REQUEST_TIMEOUT_MS must be a positive integer.*"-1"/m);
  assert.equal(child.stdout, "", "nothing on stdout (the MCP protocol channel)");
  delete process.env.PROCORE_REQUEST_TIMEOUT_MS;

  // ---- every request carries a live timeout signal ----
  r = await call("GET", [reply(200)]);
  assert.equal(statusOf(r), 200);
  assert.ok(apiCalls[0].signal instanceof AbortSignal, "fetch must get an AbortSignal");
  assert.equal(apiCalls[0].signal.aborted, false);
  assert.equal(apiCalls[0].url, `https://sandbox.procore.com${PATH}`);

  // ---- GET: 503 then success is retried with backoff ----
  r = await call("GET", [reply(503), reply(200)]);
  assert.equal(statusOf(r), 200);
  assert.equal(apiCalls.length, 2);
  assert.deepEqual(delays, [1000]);

  // ---- GET: a timeout is retried like any transient failure ----
  r = await call("GET", [timedOut, reply(200)]);
  assert.equal(statusOf(r), 200);
  assert.equal(apiCalls.length, 2);

  // ---- GET: timeouts until retries run out name the timeout, method and path ----
  r = await call("GET", [timedOut, timedOut, timedOut, timedOut]);
  assert.equal(apiCalls.length, 4, "1 attempt + 3 retries");
  assert.equal(r.leftover, 0);
  assert.match(errorOf(r), /timed out after 30000 ms: GET \/rest\/v1\.0\/projects/);
  assert.match(errorOf(r), /gave up after 4 attempts/);
  assert.deepEqual(delays, [1000, 2000, 4000]);

  process.env.PROCORE_REQUEST_TIMEOUT_MS = "5000";
  r = await call("DELETE", [timedOut, timedOut, timedOut, timedOut]);
  assert.match(errorOf(r), /timed out after 5000 ms: DELETE \/rest\/v1\.0\/projects/, "the configured value is the one reported");
  delete process.env.PROCORE_REQUEST_TIMEOUT_MS;

  // ---- GET: network errors are retried, and the exhausted error keeps the cause ----
  r = await call("GET", [networkDown, reply(200)]);
  assert.equal(statusOf(r), 200);
  r = await call("GET", [networkDown, networkDown, networkDown, networkDown]);
  assert.match(errorOf(r), /request failed: GET \/rest\/v1\.0\/projects: fetch failed/);
  assert.doesNotMatch(errorOf(r), /timed out/, "a network error is not reported as a timeout");

  // ---- 401: exactly one refresh, then a retry with the new token ----
  r = await call("GET", [reply(401), reply(200)]);
  assert.equal(statusOf(r), 200);
  assert.equal(mints, 1, "one token refresh");
  assert.equal(apiCalls.length, 2);
  assert.notEqual(apiCalls[0].authorization, apiCalls[1].authorization);
  assert.equal(apiCalls[1].authorization, `Bearer tok-${tokenSeq}`, "retry uses the refreshed token");

  r = await call("GET", [reply(401), reply(401)]);
  assert.equal(statusOf(r), 401, "a second 401 is returned, not refreshed again");
  assert.equal(mints, 1);
  assert.equal(apiCalls.length, 2);

  console.log("verify-client: all invariants hold");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => rmSync(TOKEN_PATH, { force: true }));
