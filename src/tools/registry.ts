import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleDiscoverCategories } from "./handlers/discover-categories.js";
import { handleDiscoverEndpoints } from "./handlers/discover-endpoints.js";
import { handleGetEndpointDetails } from "./handlers/get-endpoint-details.js";
import { handleCallApi } from "./handlers/call-api.js";
import { handleSearchEndpoints } from "./handlers/search-endpoints.js";
import { handleGetConfig } from "./handlers/get-config.js";
import { handleSetConfig } from "./handlers/set-config.js";

/** The four discovery tools and get_config read only the catalog bundled with
 *  this server — no Procore request, no credentials, nothing observable
 *  outside this process, hence openWorldHint: false. */
const LOCAL_READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerTools(server: McpServer): void {
  // 1. Discover Categories
  server.registerTool(
    "procore_discover_categories",
    {
      title: "Discover Procore API Categories",
      description:
        "Lists Procore's API surface as a Category > Module tree with an endpoint count for each. " +
        "Start here when you do not yet know which part of Procore holds the data you need; if you " +
        "already know the resource by name ('RFI', 'budget'), procore_search_endpoints gets you there " +
        "in one step instead of three. The category and module names returned are the exact values " +
        "procore_discover_endpoints expects. Takes no arguments and returns a JSON object. " +
        "Reads the catalog bundled with this server, so it makes no Procore request and needs no " +
        "authentication — it cannot fail with 401/403 and costs no rate limit. " +
        "Step 1 of the discover -> detail -> call workflow.",
      inputSchema: z.object({}),
      annotations: { title: "Discover API Categories", ...LOCAL_READ_ONLY },
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
        "Lists the Procore endpoints inside one category or module, optionally narrowed by a summary " +
        "substring or HTTP method. Use it after procore_discover_categories to enumerate a focused " +
        "area; prefer procore_search_endpoints when you have a keyword but no category. " +
        "Every argument is optional, but omitting all of them returns the entire ~3,100-endpoint " +
        "catalog, so pass at least a category or a search term. " +
        "Returns a JSON array of {operationId, summary, method, path}; feed an operationId to " +
        "procore_get_endpoint_details. Filters that match nothing return an empty array, not an error. " +
        "Reads the bundled catalog: no Procore request, no authentication, no rate-limit cost. " +
        "Step 2 of the workflow.",
      inputSchema: z.strictObject({
        category: z
          .string()
          .optional()
          .describe(
            "Top-level category, exactly as returned by procore_discover_categories, e.g. 'Project Management', 'Core', 'Construction Financials'"
          ),
        module: z
          .string()
          .optional()
          .describe(
            "Module within the category, e.g. 'RFI', 'Submittals', 'Punch List'. Ignored unless category is also given."
          ),
        search: z
          .string()
          .optional()
          .describe(
            "Case-insensitive substring matched against endpoint summary text; combine with category to narrow a large module"
          ),
        method_filter: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .optional()
          .describe(
            "Restrict results to a single HTTP method — useful to list only the reads (GET) in a module"
          ),
      }),
      annotations: { title: "Discover Endpoints", ...LOCAL_READ_ONLY },
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
        "Returns the complete parameter schema for one Procore endpoint: every path, query, and body " +
        "field with its type and required flag, plus the response shape. " +
        "Call this after discovery and before procore_call_api — it needs exact parameter names, " +
        "and guessing them is the most common cause of a rejected request. " +
        "Takes the operationId string that procore_discover_endpoints and procore_search_endpoints " +
        "return; an unrecognized operation_id comes back as a not-found message rather than an error. " +
        "Reads the bundled catalog: no Procore request, no authentication, no rate-limit cost. " +
        "Step 3 of the workflow.",
      inputSchema: z.strictObject({
        operation_id: z
          .string()
          .describe(
            "The exact operationId from procore_discover_endpoints or procore_search_endpoints, e.g. 'RestV10ProjectsProjectIdRfisGet'. Case-sensitive; not a URL path."
          ),
      }),
      annotations: { title: "Get Endpoint Details", ...LOCAL_READ_ONLY },
    },
    async (args) => {
      const text = await handleGetEndpointDetails(args);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 4. Call API (the core tool)
  server.registerTool(
    "procore_call_api",
    {
      title: "Execute Any Procore API Call",
      description:
        "Executes any Procore REST API call. This is the only tool here that reaches Procore and the " +
        "only one that can change data — resolve the exact method, path, and parameters with " +
        "procore_get_endpoint_details first. " +
        "WRITES ARE REAL: DELETE permanently removes the record, POST creates one, and PATCH/PUT " +
        "overwrite fields, so confirm the target id before calling and prefer a GET to verify it exists. " +
        "Handles OAuth from the saved tokens, substitutes {placeholders} from path_params, and rewrites " +
        "double underscores in query keys into brackets (filters__status becomes filters[status]). " +
        "company_id and project_id fall back to whatever procore_set_config holds when the path needs " +
        "them and you omit them. " +
        "Returns the parsed JSON response together with pagination and rate-limit metadata. Failures " +
        "come back as an error payload carrying the HTTP status — commonly 401 when the token has " +
        "expired, 403 without tool permission, 404 when an id does not resolve, 422 when the body fails " +
        "validation, and 429 when the rate limit is exhausted. " +
        "Step 4 of the workflow; this reaches every Procore endpoint, including any not exposed as a " +
        "dedicated tool.",
      inputSchema: z.strictObject({
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .describe(
            "HTTP method for the endpoint, exactly as reported by the discovery tools"
          ),
        path: z
          .string()
          .describe(
            "API path with placeholders left intact, e.g. '/rest/v1.0/projects/{project_id}/rfis'. Supply the values via path_params rather than interpolating them here."
          ),
        path_params: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Values substituted into the path's {placeholders}, e.g. { project_id: '12345' }. Required whenever the path contains a placeholder that procore_set_config does not already supply."
          ),
        query_params: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe(
            "Query-string parameters. Use double underscores for Procore's bracket syntax: filters__status becomes filters[status]."
          ),
        body: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "JSON request body for POST/PUT/PATCH. Use the exact field names and nesting from procore_get_endpoint_details; ignored on GET and DELETE."
          ),
        company_id: z
          .number()
          .optional()
          .describe(
            "Overrides the Procore-Company-Id header for this call only; defaults to the configured company"
          ),
        page: z
          .number()
          .optional()
          .describe("1-indexed page number for paginated endpoints (default 1)"),
        per_page: z
          .number()
          .optional()
          .describe("Items per page, 1-100 (default 100)"),
      }),
      annotations: {
        title: "Procore API Call",
        readOnlyHint: false,
        // This tool can issue a DELETE, so the destructive path is genuinely
        // reachable even though most calls through it are reads.
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const text = await handleCallApi(args);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // 5. Search Endpoints
  server.registerTool(
    "procore_search_endpoints",
    {
      title: "Full-Text Search Across Endpoints",
      description:
        "Searches every Procore endpoint's summary, tag, and path for a term and returns the matches " +
        "ranked by relevance. This is the fastest way in when you already know roughly what you want " +
        "('punch list', 'submittal', 'budget line item'); reach for procore_discover_categories instead " +
        "when you want to browse the API surface rather than search it. " +
        "Returns a JSON array of {operationId, summary, method, path}; feed an operationId to " +
        "procore_get_endpoint_details to get its parameters. A term with no matches returns an empty " +
        "array, so retry with a broader or singular form before concluding the endpoint does not exist. " +
        "Reads the bundled catalog: no Procore request, no authentication, no rate-limit cost.",
      inputSchema: z.strictObject({
        query: z
          .string()
          .describe(
            "Search term matched against endpoint summaries, tags, and paths, e.g. 'RFI', 'budget', 'punch list'. Single keywords match more broadly than phrases."
          ),
      }),
      annotations: { title: "Search Endpoints", ...LOCAL_READ_ONLY },
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
        "Reports this server's current state: whether Procore OAuth tokens are present and still valid, " +
        "the default company_id, and the active project_id that procore_call_api substitutes when you " +
        "omit those parameters. " +
        "Check this first when a call fails with 401 or 403, or to confirm which project subsequent " +
        "calls will target before running a write. " +
        "Never returns token values or the client secret — only whether credentials are present. " +
        "Takes no arguments and returns a JSON object. Reads local process state, so it makes no " +
        "Procore request. Pair with procore_set_config to change any of it.",
      inputSchema: z.object({}),
      annotations: { title: "Show Config", ...LOCAL_READ_ONLY },
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
        "Sets the default company_id or project_id that later procore_call_api requests use when the " +
        "path needs one and you omit it. Use it to switch project context mid-session instead of " +
        "restarting the server, then call procore_get_config to confirm what took effect. " +
        "Only 'company_id' and 'project_id' are accepted; both are coerced to integers, and a " +
        "non-numeric value is reported back as a message rather than stored. " +
        "The change lives in memory for this server process only — it is never written to disk and is " +
        "lost on restart. Setting the same value twice is a no-op, and nothing in Procore is modified: " +
        "this only changes which ids this server fills in for you. " +
        "Returns a confirmation plus the full updated configuration.",
      inputSchema: z.strictObject({
        key: z
          .enum(["company_id", "project_id"])
          .describe(
            "Which default to set. These are the only accepted keys; any other value is rejected."
          ),
        value: z
          .string()
          .describe(
            "The id to store, as a string of digits (e.g. '12345'). Coerced to an integer; a non-numeric value is rejected."
          ),
      }),
      annotations: {
        title: "Set Config",
        readOnlyHint: false,
        // Changes only this process's in-memory defaults; nothing in Procore.
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
