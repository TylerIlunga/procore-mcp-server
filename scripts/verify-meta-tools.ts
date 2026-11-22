/**
 * Verifies the 7 meta tools exactly as a client sees them over MCP:
 *
 *   - tools/list holds exactly 7 tools, each named procore_<verb>_<noun> with
 *     a verb from META_VERBS first (Glama TDQS naming consistency)
 *   - no retired name from DEPRECATED_TOOL_ALIASES is listed, and every alias
 *     points at a tool that is listed
 *   - tools/call on a retired name is routed to its replacement. Arguments
 *     that fail input validation prove the routing without any network call:
 *     the SDK's validation error names the tool that actually handled it.
 *
 * Run: npm test (tsx scripts/verify-meta-tools.ts)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../src/tools/registry.js";
import { DEPRECATED_TOOL_ALIASES, withToolAliases } from "../src/tools/tool-aliases.js";

const META_NAME = /^procore_[a-z]+_[a-z_]+$/;
const META_VERBS = new Set(["discover", "get", "search", "call", "set"]);
const EXPECTED_COUNT = 7;

const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

const server = new McpServer({ name: "procore-verify", version: "0.0.0" });
registerTools(server);
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(withToolAliases(serverSide));
const client = new Client({ name: "verify-meta-tools", version: "0.0.0" });
await client.connect(clientSide);

const names = (await client.listTools()).tools.map((t) => t.name);
check(names.length === EXPECTED_COUNT, `tools/list holds ${names.length} tools; expected ${EXPECTED_COUNT}`);
for (const name of names) {
  check(META_NAME.test(name), `meta tool name is not procore_<verb>_<noun>: ${name}`);
  const verb = name.split("_")[1];
  check(META_VERBS.has(verb), `meta tool name does not lead with a known verb (${verb}): ${name}`);
}

// The alias's stderr notice is expected here; silence it so the test output stays readable.
const realError = console.error;
console.error = () => {};
try {
  for (const [oldName, newName] of Object.entries(DEPRECATED_TOOL_ALIASES)) {
    check(!names.includes(oldName), `retired tool name is still listed: ${oldName}`);
    check(names.includes(newName), `alias ${oldName} points at an unlisted tool: ${newName}`);

    const result = await client.callTool({ name: oldName, arguments: {} });
    const text = JSON.stringify(result.content);
    check(result.isError === true, `alias ${oldName} accepted arguments that should fail validation`);
    check(
      text.includes(`tool ${newName}`) && !text.includes("not found"),
      `alias ${oldName} was not routed to ${newName}: ${text.slice(0, 200)}`
    );
  }
} finally {
  console.error = realError;
}

// Every parameterised tool advertises additionalProperties:false, and the
// runtime must agree: an unknown key is a validation error naming the key, not
// silently dropped (zod 4 plain objects strip it and omit the keyword).
const listed = await client.listTools();
for (const tool of listed.tools) {
  const props = Object.keys((tool.inputSchema.properties as object | undefined) ?? {});
  if (props.length === 0) continue;
  check(
    tool.inputSchema.additionalProperties === false,
    `${tool.name} input schema does not declare additionalProperties: false`
  );
}
const unknownKey = await client.callTool({
  name: "procore_call_api",
  arguments: { method: "GET", path: "/rest/v1.0/me", not_a_param: 1 },
});
check(
  unknownKey.isError === true && JSON.stringify(unknownKey.content).includes("not_a_param"),
  `an unknown argument was not rejected by name: ${JSON.stringify(unknownKey.content).slice(0, 200)}`
);

await client.close();

if (failures.length > 0) {
  console.error(`Meta-tool verification FAILED (${failures.length} problem(s)):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `Meta-tool verification passed: ${names.length} tools, all procore_<verb>_<noun>; ` +
    `${Object.keys(DEPRECATED_TOOL_ALIASES).length} retired name(s) hidden and routed.`
);
