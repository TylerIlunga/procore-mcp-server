/**
 * Tool error signalling, as an MCP client sees it (src/tools/error-hints.ts):
 *
 *   - a Procore response with status >= 400 comes back with isError: true, the
 *     status line and Procore's body, and a recovery hint for its category
 *   - 2xx (including a valid empty list) stays a plain success, format unchanged
 *   - thrown failures (timeout, network, bad arguments) get their own hint, not
 *     the old generic "check the endpoint path" one
 *
 * Exercised through a real in-memory MCP Client against procore_call_api and two
 * auto-registered endpoint tools. fetch is mocked; nothing touches the network
 * or the real ~/.procore-mcp/tokens.json. Run by `npm test`.
 */
import { readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_PATH = join(tmpdir(), `procore-mcp-verify-tool-errors-${process.pid}.json`);
process.env.PROCORE_ENV = "sandbox";
process.env.PROCORE_CLIENT_ID = "test-id";
process.env.PROCORE_CLIENT_SECRET = "test-secret";
process.env.PROCORE_TOKEN_PATH = TOKEN_PATH; // never the real ~/.procore-mcp/tokens.json
process.env.PROCORE_GRANT_TYPE = "client_credentials"; // token comes from the mocked endpoint
delete process.env.PROCORE_REQUEST_TIMEOUT_MS;
delete process.env.PROCORE_COMPANY_ID;

const TOKEN_URL = "https://login-sandbox.procore.com/oauth/token";
const RFIS = "/rest/v1.0/projects/{project_id}/rfis";

type Responder = (init?: RequestInit) => Response | Promise<Response>;
let responder: Responder = () => {
  throw new Error("no responder set");
};
let apiCalls = 0;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url) === TOKEN_URL) {
    return json({ access_token: "tok", token_type: "Bearer", expires_in: 5400 });
  }
  apiCalls++;
  return responder(init);
}) as typeof fetch;

// A healthy rate-limit header on every reply, so a 429 case doesn't leave the
// client's in-memory budget at 0 and add a warning line to later successes.
const json = (obj: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "X-Rate-Limit-Remaining": "3600", "X-Rate-Limit-Limit": "3600", ...headers },
  });
const always = (status: number, body: unknown, headers: Record<string, string> = {}): Responder => () =>
  json(body, status, headers);
/** Never answers; rejects the way real fetch does once AbortSignal.timeout fires.
 *  That timer is unref'd, so a ref'd one keeps the process alive until it fires. */
const hang: Responder = (init) =>
  new Promise((_, reject) => {
    const keepAlive = setTimeout(() => reject(new Error("abort signal never fired")), 10_000);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(keepAlive);
      reject(init.signal?.reason);
    });
  });
const networkDown: Responder = () => {
  throw new TypeError("fetch failed");
};

const { setDelayFn } = await import("../src/api/client.js");
setDelayFn(async () => {}); // backoff and Retry-After waits are instant
const { registerTools } = await import("../src/tools/registry.js");
const { registerAutoTools } = await import("../src/tools/auto-register.js");
const { classifyHttpError, classifyThrownError } = await import("../src/tools/error-hints.js");
type Entry = import("../src/tools/auto-register.js").ToolManifestEntry;

const manifest = JSON.parse(readFileSync(join(ROOT, "data", "tools-manifest.json"), "utf8")) as Entry[];
const pick = (method: string, path: string): Entry => {
  const entry = manifest.find((e) => e.method === method && e.path === path);
  if (!entry) throw new Error(`manifest has no ${method} ${path}`);
  return entry;
};
const listRfis = pick("GET", RFIS);
const createRfi = pick("POST", RFIS);

const server = new McpServer({ name: "procore-verify", version: "0.0.0" });
registerTools(server);
const autoCount = registerAutoTools(server, [listRfis, createRfi]);
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "verify-tool-errors", version: "0.0.0" });
await client.connect(clientSide);

const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

type Outcome = { isError: boolean; text: string; calls: number };
async function run(name: string, args: Record<string, unknown>, respond: Responder): Promise<Outcome> {
  responder = respond;
  apiCalls = 0;
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  return { isError: result.isError === true, text: content.map((c) => c.text ?? "").join("\n"), calls: apiCalls };
}

const META = "procore_call_api";
const metaGet = { method: "GET", path: RFIS, path_params: { project_id: "1" } };
const metaPost = { method: "POST", path: RFIS, path_params: { project_id: "1" }, body: { rfi: { subject: "x" } } };
const autoGet = { project_id: 1 };
const autoPost = { project_id: 1, subject: "x", rfi_manager_id: 2, question: { body: "?" } };
const PATH_HINT = /Check the endpoint path and parameters/;
const forbidden = { errors: "Tool is not activated for this project", code: "TOOL_NOT_ACTIVATED" };

/** Shared assertions for one error case; `label` names the tool and scenario. */
function expectError(label: string, r: Outcome, category: string, status: number | null, hint: RegExp): void {
  check(r.isError, `${label}: isError must be true; got text: ${r.text.slice(0, 160)}`);
  check(r.text.startsWith(`Error category: ${category} (`), `${label}: first line should name category ${category}: ${r.text.split("\n")[0]}`);
  if (status !== null) check(r.text.includes(`Status: ${status}`), `${label}: status line ${status} missing`);
  check(hint.test(r.text), `${label}: hint ${hint} missing: ${r.text.slice(-240)}`);
  check(!PATH_HINT.test(r.text), `${label}: still carries the generic path hint`);
}

check(autoCount === 2, `expected 2 auto-registered tools, got ${autoCount}`);

for (const [tool, get, post] of [
  [META, metaGet, metaPost],
  [listRfis.toolName, autoGet, autoPost],
] as const) {
  const postTool = tool === META ? META : createRfi.toolName;

  let r = await run(tool, get, always(200, [{ id: 1 }]));
  check(!r.isError, `${tool} 200: must not be an error`);
  check(r.text === 'Status: 200 OK\n\nResponse:\n[\n  {\n    "id": 1\n  }\n]', `${tool} 200: success format changed: ${JSON.stringify(r.text)}`);

  r = await run(tool, get, always(200, []));
  check(!r.isError, `${tool} 200 []: a valid empty result is a success, not an error`);
  check(r.text.includes("Response:\n[]"), `${tool} 200 []: body missing`);

  r = await run(tool, get, always(404, { errors: "Not Found" }));
  expectError(`${tool} 404`, r, "not_found", 404, /company_id\/project_id/);
  check(r.text.includes('"errors": "Not Found"'), `${tool} 404: Procore's body must be kept`);

  r = await run(tool, get, always(403, forbidden));
  expectError(`${tool} 403`, r, "permission", 403, /lacks permission.*Procore error code: TOOL_NOT_ACTIVATED\./s);
  check(r.text.includes("Tool is not activated for this project"), `${tool} 403: Procore's body must be kept`);

  r = await run(tool, get, always(422, { errors: { subject: ["can't be blank"] } }));
  expectError(`${tool} 422`, r, "validation", 422, /procore_get_endpoint_details/);

  r = await run(tool, get, always(500, { error: "boom" }));
  expectError(`${tool} GET 500`, r, "server_error", 500, /transient; retry later/);
  check(r.calls === 4, `${tool} GET 500: idempotent retries expected 4 attempts, got ${r.calls}`);

  r = await run(postTool, post, always(503, { error: "unavailable" }));
  expectError(`${postTool} POST 503`, r, "server_error", 503, /check whether it took effect/);
  check(r.text.includes("Not retried: POST"), `${postTool} POST 503: not-retried notice missing`);
  check(r.calls === 1, `${postTool} POST 503: must not be resent, got ${r.calls} attempts`);

  process.env.PROCORE_REQUEST_TIMEOUT_MS = "20";
  r = await run(tool, get, hang);
  delete process.env.PROCORE_REQUEST_TIMEOUT_MS;
  expectError(`${tool} timeout`, r, "timeout", null, /PROCORE_REQUEST_TIMEOUT_MS/);
  check(r.text.includes("timed out after 20 ms"), `${tool} timeout: message missing: ${r.text}`);
  check(!r.text.includes("procore_get_endpoint_details"), `${tool} timeout: must not point at endpoint details`);

  r = await run(tool, get, always(401, { error: "invalid_token" }));
  expectError(`${tool} 401`, r, "auth", 401, /npm run auth/);

  r = await run(tool, get, always(429, { error: "slow down" }, { "Retry-After": "0" }));
  expectError(`${tool} 429`, r, "rate_limited", 429, /Wait, then retry later/);

  r = await run(tool, get, networkDown);
  expectError(`${tool} network`, r, "network", null, /transient connectivity/);
}

// Bad arguments on procore_call_api are caught before any request goes out.
const r = await run(META, { method: "GET", path: RFIS }, always(200, []));
expectError("procore_call_api unfilled placeholder", r, "local_validation", null, /no request was sent/);
check(r.text.includes("project_id"), "unfilled placeholder: the missing name must be listed");
check(r.calls === 0, `unfilled placeholder: no request expected, got ${r.calls}`);

// Categories not reachable through the mock above, checked on the classifier directly.
const postTimeout = new Error(
  "Procore request timed out after 20 ms: POST /x. Not retried: POST is not idempotent, and Procore may already have applied the request."
);
check(classifyThrownError(postTimeout).retry === "check before resending", "POST timeout must say check before resending");
check(classifyThrownError(new Error("PROCORE_ENV must be one of production")).category === "config", "env error is config");
check(classifyThrownError(new Error("Token refresh failed (500): x")).category === "auth", "token refresh failure is auth");
check(classifyHttpError(409, { errors: "conflict" }).category === "client_error", "other 4xx is client_error");
check(classifyHttpError(403, { error: { code: "TOOL_NOT_ACTIVATED" } }).hint.includes("TOOL_NOT_ACTIVATED"), "nested code surfaces");

await client.close();
rmSync(TOKEN_PATH, { force: true });

if (failures.length > 0) {
  console.error(`Tool error verification FAILED (${failures.length} problem(s)):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-tool-errors: HTTP >= 400 and thrown failures are flagged with category-specific hints");
