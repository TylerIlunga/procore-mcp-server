import { procoreApiCall } from "../../api/client.js";
import type { ApiCallOptions } from "../../api/types.js";

export async function handleApiCall(args: {
  method: string;
  path: string;
  path_params?: Record<string, string>;
  query_params?: Record<string, string | number | boolean>;
  body?: Record<string, unknown>;
  company_id?: number;
  page?: number;
  per_page?: number;
}): Promise<string> {
  const options: ApiCallOptions = {
    method: args.method,
    path: args.path,
    pathParams: args.path_params,
    queryParams: args.query_params,
    body: args.body,
    companyId: args.company_id,
    page: args.page,
    perPage: args.per_page,
  };

  try {
    const response = await procoreApiCall(options);

    const parts: string[] = [];

    // Status
    if (response.status >= 200 && response.status < 300) {
      parts.push(`Status: ${response.status} OK`);
    } else {
      parts.push(`Status: ${response.status}`);
    }

    // Data
    const dataStr = JSON.stringify(response.data, null, 2);
    if (dataStr.length > 50000) {
      parts.push(
        `\nResponse (truncated to 50KB):\n${dataStr.slice(0, 50000)}\n... (truncated)`
      );
    } else {
      parts.push(`\nResponse:\n${dataStr}`);
    }

    // Pagination
    if (response.pagination) {
      const p = response.pagination;
      parts.push(`\nPagination: page ${p.current_page}, ${p.per_page} per page`);
      if (p.total !== undefined) {
        parts.push(`Total items: ${p.total}`);
      }
      if (p.has_next) {
        parts.push(
          `Has more pages — call again with page=${p.current_page + 1}`
        );
      } else {
        parts.push("No more pages.");
      }
    }

    // Rate limit warning
    if (response.rate_limit && response.rate_limit.remaining < 20) {
      parts.push(
        `\n⚠ Rate limit: ${response.rate_limit.remaining}/${response.rate_limit.limit} requests remaining`
      );
    }

    return parts.join("\n");
  } catch (err) {
    const error = err as Error;
    return `Error: ${error.message}\n\nSuggestion: Check the endpoint path and parameters. Use procore_get_endpoint_details to verify the correct format.`;
  }
}
