import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleDiscoverCategories } from "./handlers/discover-categories.js";
import { handleDiscoverEndpoints } from "./handlers/discover-endpoints.js";
import { handleGetEndpointDetails } from "./handlers/get-endpoint-details.js";
import { handleApiCall } from "./handlers/api-call.js";
import { handleSearchEndpoints } from "./handlers/search-endpoints.js";
import { handleGetConfig } from "./handlers/get-config.js";
import { handleSetConfig } from "./handlers/set-config.js";

export function registerTools(server: McpServer): void {
  // 1. Discover Categories
  server.tool(
    "procore_discover_categories",
    "List all Procore API categories with their modules and endpoint counts. Start here to explore the API.",
    {},
    async () => {
      const text = await handleDiscoverCategories();
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 2. Discover Endpoints
  server.tool(
    "procore_discover_endpoints",
    "List endpoints within a specific category and optional module. Use after discover_categories to drill into a specific area.",
    {
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
          "Module within category, e.g. 'RFI', 'Submittals', 'Punch List'"
        ),
      search: z
        .string()
        .optional()
        .describe("Filter endpoints by summary text"),
      method_filter: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
        .optional()
        .describe("Filter by HTTP method"),
    },
    async (args) => {
      const text = await handleDiscoverEndpoints(args);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 3. Get Endpoint Details
  server.tool(
    "procore_get_endpoint_details",
    "Get full parameter schema, request body, and response format for a specific endpoint. Use the operationId from discover_endpoints.",
    {
      operation_id: z
        .string()
        .describe(
          "The operationId from discover_endpoints, e.g. 'RestV10ProjectsProjectIdRfisGet'"
        ),
    },
    async (args) => {
      const text = await handleGetEndpointDetails(args);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 4. API Call (the core tool)
  server.tool(
    "procore_api_call",
    "Execute any Procore API call. Use discover/search tools to find the right endpoint first, then call it here with the correct method, path, and parameters.",
    {
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
          "Path parameter substitutions, e.g. { project_id: '12345' }"
        ),
      query_params: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe(
          "Query parameters. Use __ for nested brackets, e.g. filters__status becomes filters[status]"
        ),
      body: z
        .record(z.unknown())
        .optional()
        .describe("Request body for POST/PUT/PATCH requests"),
      company_id: z
        .number()
        .optional()
        .describe("Override the default Procore-Company-Id header"),
      page: z
        .number()
        .optional()
        .describe("Page number for paginated endpoints"),
      per_page: z
        .number()
        .optional()
        .describe("Items per page, max 100"),
    },
    async (args) => {
      const text = await handleApiCall(args);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 5. Search Endpoints
  server.tool(
    "procore_search_endpoints",
    "Full-text search across all 2,636 Procore API endpoint summaries, tags, and paths. Use to quickly find relevant endpoints.",
    {
      query: z
        .string()
        .describe(
          "Search term, e.g. 'RFI', 'budget', 'punch list', 'submittal'"
        ),
    },
    async (args) => {
      const text = await handleSearchEndpoints(args);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 6. Get Config
  server.tool(
    "procore_get_config",
    "Show current MCP server configuration including auth status, default company ID, and runtime settings.",
    {},
    async () => {
      const text = await handleGetConfig();
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 7. Set Config
  server.tool(
    "procore_set_config",
    "Set runtime configuration values (company_id, project_id). These persist for the current session.",
    {
      key: z
        .string()
        .describe("Config key: 'company_id' or 'project_id'"),
      value: z.string().describe("Config value"),
    },
    async (args) => {
      const text = await handleSetConfig(args);
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
