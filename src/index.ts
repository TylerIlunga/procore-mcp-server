import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/registry.js";
import { registerAutoTools } from "./tools/auto-register.js";
import { loadCatalog, loadCategories } from "./catalog/repository.js";
import { tokensExist } from "./auth/token-store.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The published package version, so the MCP handshake reports the truth. */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")
    );
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Load .env file manually
function loadEnv(): void {
  // When compiled: dist/src/index.js → need ../../.env to reach project root
  const envPath = join(__dirname, "..", "..", ".env");
  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env not found, rely on env vars passed by Claude Desktop/Code
  }
}

async function main(): Promise<void> {
  loadEnv();

  // Validate required env vars
  const clientId = process.env.PROCORE_CLIENT_ID;
  const clientSecret = process.env.PROCORE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      "ERROR: PROCORE_CLIENT_ID and PROCORE_CLIENT_SECRET are required.\n" +
        "Set them in .env or pass via Claude Desktop/Code config."
    );
    process.exit(1);
  }

  // Check tokens exist
  if (!tokensExist()) {
    console.error(
      "ERROR: No Procore auth tokens found.\n" +
        "Run 'npm run auth' to authenticate with Procore first."
    );
    process.exit(1);
  }

  // Pre-load catalog into memory
  try {
    const catalog = loadCatalog();
    const categories = loadCategories();
    console.error(
      `Catalog loaded: ${catalog.length} endpoints, ${Object.keys(categories.categories).length} categories`
    );
  } catch (err) {
    console.error(
      "ERROR: Failed to load catalog. Run 'npm run build' first.\n" +
        (err as Error).message
    );
    process.exit(1);
  }

  // Create MCP server
  const server = new McpServer({
    name: "procore",
    version: packageVersion(),
  });

  // Register 7 meta/discovery tools
  registerTools(server);

  // Register all auto-generated endpoint tools unless the host opted into
  // the lean surface. PROCORE_TOOL_MODE=meta serves only the 7 discovery
  // tools — full API coverage stays available through procore_api_call while
  // keeping the tool list small enough for context-constrained clients.
  let autoCount = 0;
  if ((process.env.PROCORE_TOOL_MODE || "all").toLowerCase() !== "meta") {
    autoCount = registerAutoTools(server);
    console.error(`Auto-registered ${autoCount} endpoint tools`);
  } else {
    console.error(
      "PROCORE_TOOL_MODE=meta — serving the 7 discovery tools only"
    );
  }

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`Procore MCP server running — ${autoCount + 7} total tools`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
