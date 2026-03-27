/**
 * Auto-registers individual MCP tools from the tools manifest.
 * Each endpoint in the manifest becomes a dedicated, named tool.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, ZodRawShape } from "zod";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { procoreApiCall } from "../api/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, "..", "..", "..", "data", "tools-manifest.json");

interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  enum?: unknown[];
  source: "path" | "query" | "body";
}

interface ToolManifestEntry {
  toolName: string;
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  category: string;
  module: string;
  version: string;
  contentType: string | null;
  params: ToolParam[];
  bodyWrapper?: string;
}

function buildZodType(param: ToolParam): z.ZodTypeAny {
  let zodType: z.ZodTypeAny;

  switch (param.type) {
    case "number":
      zodType = z.number().describe(param.description);
      break;
    case "boolean":
      zodType = z.boolean().describe(param.description);
      break;
    case "array":
      zodType = z.array(z.unknown()).describe(param.description);
      break;
    case "object":
      zodType = z.record(z.unknown()).describe(param.description);
      break;
    default:
      if (param.enum && param.enum.length > 0 && param.enum.length <= 20) {
        const enumValues = param.enum.map(String);
        zodType = z
          .enum(enumValues as [string, ...string[]])
          .describe(param.description);
      } else {
        zodType = z.string().describe(param.description);
      }
  }

  if (!param.required) {
    zodType = zodType.optional();
  }

  return zodType;
}

function createToolHandler(entry: ToolManifestEntry) {
  return async (args: Record<string, unknown>) => {
    // Split args into path params, query params, and body params
    const pathParams: Record<string, string> = {};
    const queryParams: Record<string, string | number | boolean> = {};
    const bodyObj: Record<string, unknown> = {};

    for (const param of entry.params) {
      const value = args[param.name];
      if (value === undefined || value === null) continue;

      switch (param.source) {
        case "path":
          pathParams[param.name] = String(value);
          break;
        case "query":
          queryParams[param.name] = value as string | number | boolean;
          break;
        case "body":
          bodyObj[param.name] = value;
          break;
      }
    }

    // Reconstruct body wrapper if needed
    let body: Record<string, unknown> | undefined;
    if (Object.keys(bodyObj).length > 0) {
      if (entry.bodyWrapper) {
        body = { [entry.bodyWrapper]: bodyObj };
      } else {
        body = bodyObj;
      }
    }

    try {
      const response = await procoreApiCall({
        method: entry.method,
        path: entry.path,
        pathParams: Object.keys(pathParams).length > 0 ? pathParams : undefined,
        queryParams:
          Object.keys(queryParams).length > 0 ? queryParams : undefined,
        body,
      });

      const parts: string[] = [];

      if (response.status >= 200 && response.status < 300) {
        parts.push(`Status: ${response.status} OK`);
      } else {
        parts.push(`Status: ${response.status}`);
      }

      const dataStr = JSON.stringify(response.data, null, 2);
      if (dataStr.length > 50000) {
        parts.push(
          `\nResponse (truncated):\n${dataStr.slice(0, 50000)}\n... (truncated)`
        );
      } else {
        parts.push(`\nResponse:\n${dataStr}`);
      }

      if (response.pagination) {
        const p = response.pagination;
        parts.push(
          `\nPagination: page ${p.current_page}, ${p.per_page}/page`
        );
        if (p.total !== undefined) parts.push(`Total: ${p.total}`);
        if (p.has_next)
          parts.push(`More pages available — use page=${p.current_page + 1}`);
      }

      if (response.rate_limit && response.rate_limit.remaining < 20) {
        parts.push(
          `\nRate limit: ${response.rate_limit.remaining}/${response.rate_limit.limit} remaining`
        );
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  };
}

export function registerAutoTools(server: McpServer): number {
  let manifest: ToolManifestEntry[];
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch (err) {
    console.error(
      "Failed to load tools manifest. Run 'npm run generate' first."
    );
    return 0;
  }

  let registered = 0;
  for (const entry of manifest) {
    // Build Zod schema for this tool's params
    const shape: ZodRawShape = {};

    // Limit params to avoid excessively large schemas
    // Include all path params (required) + first 30 query/body params
    const pathP = entry.params.filter((p) => p.source === "path");
    const otherP = entry.params.filter((p) => p.source !== "path");
    const selectedParams = [...pathP, ...otherP.slice(0, 30)];

    for (const param of selectedParams) {
      // Sanitize param name for Zod (replace brackets, dots, etc.)
      const safeName = param.name
        .replace(/\[/g, "__")
        .replace(/\]/g, "")
        .replace(/\./g, "_");
      shape[safeName] = buildZodType({
        ...param,
        name: safeName,
      });
    }

    // Add pagination params for GET endpoints
    if (entry.method === "GET") {
      if (!shape.page) {
        shape.page = z.number().optional().describe("Page number for pagination");
      }
      if (!shape.per_page) {
        shape.per_page = z
          .number()
          .optional()
          .describe("Items per page (max 100)");
      }
    }

    const description = `${entry.summary}. [${entry.category}/${entry.module}] ${entry.method} ${entry.path}`;

    try {
      server.tool(
        entry.toolName,
        description.slice(0, 500),
        shape,
        createToolHandler(entry)
      );
      registered++;
    } catch (err) {
      console.error(
        `Failed to register tool ${entry.toolName}: ${(err as Error).message}`
      );
    }
  }

  return registered;
}
