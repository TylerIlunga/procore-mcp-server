import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleDiscoverCategories } from "./handlers/discover-categories.js";
import { handleDiscoverEndpoints } from "./handlers/discover-endpoints.js";
import { handleGetEndpointDetails } from "./handlers/get-endpoint-details.js";
import { handleApiCall } from "./handlers/api-call.js";
import { handleSearchEndpoints } from "./handlers/search-endpoints.js";
import { handleGetConfig } from "./handlers/get-config.js";
import { handleSetConfig } from "./handlers/set-config.js";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const READ_ONLY_OPEN_WORLD = {
  ...READ_ONLY,
  openWorldHint: true,
} as const;

export function registerTools(server: McpServer): void {
  // 1. Discover Categories
  server.registerTool(
    "procore_discover_categories",
    {
      title: "Discover Procore API Categories",
      description:
        "List every Procore API category with its modules and endpoint counts. " +
        "Use this as the first step when exploring what Procore can do — it returns " +
        "a hierarchical map (Category > Module > endpoint count) that scopes any " +
        "follow-up discovery or search call. Returns a JSON object; takes no inputs.",
      inputSchema: {},
      annotations: { title: "Discover API Categories", ...READ_ONLY },
    },
    async () => {
      const text = await handleDiscoverCategories();
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 2. Discover Endpoints
  server.registerTool(
    "procore_discover_endpoints",
    {
      title: "Discover Endpoints in a Category",
      description:
        "List every Procore endpoint within a specific category (and optional module). " +
        "Use after `procore_discover_categories` to drill into a focused area such as " +
        "RFIs, Submittals, or Budgets. Filter further by free-text summary or HTTP method. " +
        "Returns a JSON array of endpoint metadata (operationId, summary, method, path).",
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe(
            "Top-level category, e.g. 'Project Management', 'Core', 'Construction Financials'"
          ),
        module: z
          .string()
          .optional()
          .describe(
            "Module within the category, e.g. 'RFI', 'Submittals', 'Punch List'"
          ),
        search: z
          .string()
          .optional()
          .describe("Substring filter applied to endpoint summary text"),
        method_filter: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .optional()
          .describe("Restrict results to a single HTTP method"),
      },
      annotations: { title: "Discover Endpoints", ...READ_ONLY },
    },
    async (args) => {
      const text = await handleDiscoverEndpoints(args);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 3. Get Endpoint Details
  server.registerTool(
    "procore_get_endpoint_details",
    {
      title: "Get Full Endpoint Details",
      description:
        "Fetch the full parameter schema, request body shape, and response format for " +
        "a single Procore endpoint. Pass an `operation_id` from `procore_discover_endpoints`. " +
        "Use this right before calling `procore_api_call` so you know exactly which " +
        "path/query/body parameters to provide. Returns a JSON object.",
      inputSchema: {
        operation_id: z
          .string()
          .describe(
            "The operationId returned by procore_discover_endpoints, e.g. 'RestV10ProjectsProjectIdRfisGet'"
          ),
      },
      annotations: { title: "Get Endpoint Details", ...READ_ONLY },
    },
    async (args) => {
      const text = await handleGetEndpointDetails(args);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 4. API Call (the core tool)
  server.registerTool(
    "procore_api_call",
    {
      title: "Execute Any Procore API Call",
      description:
        "Execute any Procore REST API call. This is the workhorse — first use the " +
        "discover/search tools to find the right endpoint, then call it here. " +
        "Handles OAuth automatically (uses the saved tokens), substitutes path " +
        "placeholders, encodes nested query brackets (`__` becomes `[`/`]`), and " +
        "returns the parsed JSON response with pagination + rate-limit metadata.",
      inputSchema: {
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .describe("HTTP method"),
        path: z
          .string()
          .describe(
            "API path with placeholders, e.g. /rest/v1.0/projects/{project_id}/rfis"
          ),
        path_params: z
          .record(z.string())
          .optional()
          .describe(
            "Substitutions for path placeholders, e.g. { project_id: '12345' }"
          ),
        query_params: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe(
            "Query parameters. Use double underscores for nested brackets: filters__status becomes filters[status]"
          ),
        body: z
          .record(z.unknown())
          .optional()
          .describe("JSON request body for POST/PUT/PATCH calls"),
        company_id: z
          .number()
          .optional()
          .describe("Override the default Procore-Company-Id header"),
        page: z.number().optional().describe("Page number for paginated endpoints"),
        per_page: z
          .number()
          .optional()
          .describe("Items per page (max 100)"),
      },
      annotations: {
        title: "Procore API Call",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const text = await handleApiCall(args);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 5. Search Endpoints
  server.registerTool(
    "procore_search_endpoints",
    {
      title: "Full-Text Search Across Endpoints",
      description:
        "Full-text search across every Procore API endpoint summary, tag, and path. " +
        "Use to quickly locate the right endpoint when you know roughly what you're " +
        "looking for — e.g. 'RFI', 'budget', 'punch list', 'submittal'. Returns " +
        "a JSON array of matches ranked by relevance.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "Search term, e.g. 'RFI', 'budget', 'punch list', 'submittal'"
          ),
      },
      annotations: { title: "Search Endpoints", ...READ_ONLY },
    },
    async (args) => {
      const text = await handleSearchEndpoints(args);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 6. Get Config
  server.registerTool(
    "procore_get_config",
    {
      title: "Show Server Configuration",
      description:
        "Show the current MCP server configuration: OAuth/auth status, default " +
        "company_id, the active runtime project_id, and other persisted settings. " +
        "Use this to debug context issues or before switching projects. Takes no inputs.",
      inputSchema: {},
      annotations: { title: "Show Config", ...READ_ONLY },
    },
    async () => {
      const text = await handleGetConfig();
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 7. Set Config
  server.registerTool(
    "procore_set_config",
    {
      title: "Set Runtime Configuration Value",
      description:
        "Set a runtime configuration key (e.g. company_id or project_id) for the " +
        "current session. The change persists until the server restarts. Use this " +
        "to switch the default company/project context without restarting the MCP " +
        "server. Returns a confirmation message.",
      inputSchema: {
        key: z
          .string()
          .describe("Config key — currently 'company_id' or 'project_id'"),
        value: z.string().describe("New value (string; numbers are coerced server-side)"),
      },
      annotations: {
        title: "Set Config",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const text = await handleSetConfig(args);
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
