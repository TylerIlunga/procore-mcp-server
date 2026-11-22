import { procoreApiCall } from "../../api/client.js";
import type { ApiCallOptions } from "../../api/types.js";
import {
  httpErrorResult,
  localValidationError,
  thrownErrorResult,
  unresolvedPlaceholders,
  type ToolTextResult,
} from "../error-hints.js";

export async function handleCallApi(args: {
  method: string;
  path: string;
  path_params?: Record<string, string>;
  query_params?: Record<string, string | number | boolean>;
  body?: Record<string, unknown>;
  company_id?: number;
  page?: number;
  per_page?: number;
}): Promise<ToolTextResult> {
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
    const missing = unresolvedPlaceholders(args.path, args.path_params);
    if (missing.length > 0) {
      throw localValidationError(
        `Path ${args.path} has unfilled placeholder(s): ${missing.join(", ")}. ` +
          `Supply them in path_params, e.g. { "${missing[0]}": "123" }.`
      );
    }
    const response = await procoreApiCall(options);

    const parts: string[] = [];

    // Status
    if (response.status >= 200 && response.status < 300) {
      parts.push(`Status: ${response.status} OK`);
    } else {
      parts.push(`Status: ${response.status}`);
    }
    if (response.notice) parts.push(response.notice);

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

    const text = parts.join("\n");
    if (response.status >= 400) {
      return httpErrorResult(response.status, response.data, response.notice, text);
    }
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return thrownErrorResult(err);
  }
}
