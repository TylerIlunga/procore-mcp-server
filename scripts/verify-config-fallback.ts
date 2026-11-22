/**
 * procore_set_config session defaults, as an MCP client sees them
 * (src/api/request-context.ts):
 *
 *   - generated tools whose description says "company_id and project_id default
 *     to the values set by procore_set_config when omitted" really let the model
 *     omit them (schema) and really fill them in (request URL)
 *   - procore_call_api fills {company_id}/{project_id} placeholders the same way
 *   - the Procore-Company-Id header follows the session company_id
 *   - explicit arguments always win; with no default, the call is rejected
 *     locally with a hint naming procore_set_config, and nothing is sent
 *
 * Real in-memory MCP Client; fetch is mocked; never touches the network or the
 * real ~/.procore-mcp/tokens.json. Run by `npm test`.
 */
import { readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_PATH = join(tmpdir(), `procore-mcp-verify-config-${process.pid}.json`);
process.env.PROCORE_ENV = "sandbox";
process.env.PROCORE_CLIENT_ID = "test-id";
process.env.PROCORE_CLIENT_SECRET = "test-secret";
process.env.PROCORE_TOKEN_PATH = TOKEN_PATH;
process.env.PROCORE_GRANT_TYPE = "client_credentials";
delete process.env.PROCORE_COMPANY_ID;

const TOKEN_URL = "https://login-sandbox.procore.com/oauth/token";
type Sent = { url: string; company: string | null };
let sent: Sent[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url) === TOKEN_URL) {
    return new Response(JSON.stringify({ access_token: "tok", token_type: "Bearer", expires_in: 5400 }), {
      headers: { "content-type": "application/json" },
    });
  }
  sent.push({ url: String(url), company: new Headers(init?.headers).get("Procore-Company-Id") });
  return new Response("[]", {
    headers: { "content-type": "application/json", "X-Rate-Limit-Remaining": "3600", "X-Rate-Limit-Limit": "3600" },
  });
}) as typeof fetch;

const { registerTools } = await import("../src/tools/registry.js");
const { registerAutoTools } = await import("../src/tools/auto-register.js");
const { resetRuntimeConfig } = await import("../src/api/request-context.js");
type Entry = import("../src/tools/auto-register.js").ToolManifestEntry;

const manifest = JSON.parse(readFileSync(join(ROOT, "data", "tools-manifest.json"), "utf8")) as Entry[];
const pick = (method: string, path: string): Entry => {
  const entry = manifest.find((e) => e.method === method && e.path === path);
  if (!entry) throw new Error(`manifest has no ${method} ${path}`);
  return entry;
};
const RFIS = "/rest/v1.0/projects/{project_id}/rfis";
const rfis = pick("GET", RFIS);

const server = new McpServer({ name: "verify-config", version: "0" });
registerTools(server);
registerAutoTools(server, [rfis]);
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "verify-config", version: "0" });
await client.connect(clientSide);

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (!ok) failures.push(msg);
};
const text = (r: Awaited<ReturnType<typeof client.callTool>>) =>
  (r.content as Array<{ text: string }>).map((c) => c.text).join("\n");
const setConfig = (key: string, value: string) =>
  client.callTool({ name: "procore_set_config", arguments: { key, value } });

try {
  // Schema: the generated tool lets the model omit the config-backed id.
  const listed = await client.listTools();
  const tool = listed.tools.find((t) => t.name === rfis.toolName);
  check(!!tool, `${rfis.toolName} not registered`);
  check(
    !(tool?.inputSchema.required ?? []).includes("project_id"),
    `${rfis.toolName} schema still requires project_id although its description says it defaults`
  );
  check(
    (tool?.description ?? "").includes("procore_set_config"),
    `${rfis.toolName} description no longer mentions the procore_set_config default`
  );

  // No default yet: rejected locally, with the hint, nothing sent.
  resetRuntimeConfig();
  sent = [];
  let r = await client.callTool({ name: rfis.toolName, arguments: {} });
  check(r.isError === true, "omitted project_id with no default must be an error");
  check(text(r).includes("procore_set_config"), `hint must name procore_set_config: ${text(r).slice(0, 200)}`);
  check(sent.length === 0, "nothing may be sent with an unfilled placeholder");

  // Session defaults fill the generated tool's path and the company header.
  await setConfig("project_id", "4242");
  await setConfig("company_id", "77");
  sent = [];
  r = await client.callTool({ name: rfis.toolName, arguments: {} });
  check(r.isError !== true, `generated tool with defaults failed: ${text(r).slice(0, 200)}`);
  check(sent[0]?.url.endsWith("/rest/v1.0/projects/4242/rfis") ?? false, `wrong URL: ${sent[0]?.url}`);
  check(sent[0]?.company === "77", `Procore-Company-Id should follow procore_set_config: ${sent[0]?.company}`);

  // An explicit argument beats the default.
  sent = [];
  await client.callTool({ name: rfis.toolName, arguments: { project_id: 9 } });
  check(sent[0]?.url.endsWith("/projects/9/rfis") ?? false, `explicit project_id must win: ${sent[0]?.url}`);

  // procore_call_api: placeholders filled from the defaults too.
  sent = [];
  r = await client.callTool({ name: "procore_call_api", arguments: { method: "GET", path: RFIS } });
  check(r.isError !== true, `procore_call_api with defaults failed: ${text(r).slice(0, 200)}`);
  check(sent[0]?.url.endsWith("/rest/v1.0/projects/4242/rfis") ?? false, `call_api wrong URL: ${sent[0]?.url}`);

  // PROCORE_COMPANY_ID env is the company fallback when nothing was set.
  resetRuntimeConfig();
  process.env.PROCORE_COMPANY_ID = "55";
  sent = [];
  await client.callTool({
    name: "procore_call_api",
    arguments: { method: "GET", path: "/rest/v1.0/companies/{company_id}/users" },
  });
  check(sent[0]?.url.endsWith("/companies/55/users") ?? false, `env company fallback: ${sent[0]?.url}`);
  check(sent[0]?.company === "55", `env company header: ${sent[0]?.company}`);
} finally {
  delete process.env.PROCORE_COMPANY_ID;
  await client.close();
  rmSync(TOKEN_PATH, { force: true });
}

if (failures.length > 0) {
  console.error(`Config fallback verification FAILED (${failures.length} problem(s)):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-config-fallback: procore_set_config defaults fill omitted company_id/project_id in schema, URL and header");
