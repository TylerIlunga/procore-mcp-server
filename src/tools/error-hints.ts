/**
 * Classifies a failed Procore call into a category with a recovery hint, so the
 * model gets advice that matches the cause instead of one generic suggestion.
 *
 * Pure: no I/O, no imports from the API client. Both `procore_call_api` and the
 * auto-registered endpoint tools build their error results here, so the two
 * cannot drift apart.
 */

export type ErrorCategory =
  | "validation"
  | "auth"
  | "permission"
  | "not_found"
  | "rate_limited"
  | "server_error"
  | "client_error"
  | "timeout"
  | "network"
  | "local_validation"
  | "config"
  | "unknown";

/** Whether resending the same call can help, as stated on the first line. */
export type Retryability = "not retryable as-is" | "retryable later" | "check before resending";

export interface ErrorClassification {
  category: ErrorCategory;
  retry: Retryability;
  hint: string;
}

/** Same shape the MCP SDK expects from a tool callback. */
export type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

/** Error name for bad tool arguments caught before any request goes out. */
export const LOCAL_VALIDATION_ERROR = "LocalValidationError";

/** Marks the client's notice on a failure it deliberately did not resend (POST/PATCH). */
const NOT_RETRIED = /Not retried: /;

const UNCONFIRMED_WRITE =
  "Procore may already have applied this write, so check whether it took effect " +
  "(e.g. GET the record) before sending it again.";

/** Status codes Procore uses for requests rejected before anything ran. */
function classifyStatus(status: number, notRetried: boolean): ErrorClassification {
  if (status === 400 || status === 422) {
    return {
      category: "validation",
      retry: "not retryable as-is",
      hint:
        "Procore rejected the parameters or body. Compare them with " +
        "procore_get_endpoint_details (names, types, required fields, body wrapper) and fix them.",
    };
  }
  if (status === 401) {
    return {
      category: "auth",
      retry: "not retryable as-is",
      hint:
        "The access token was refreshed once and Procore still rejected it. Run " +
        "`npm run auth` to log in again, or check PROCORE_CLIENT_ID/PROCORE_CLIENT_SECRET.",
    };
  }
  if (status === 403) {
    return {
      category: "permission",
      retry: "not retryable as-is",
      hint:
        "The Procore user or service account lacks permission for this resource, or the " +
        "Procore tool is not enabled for this company/project. An admin must grant access.",
    };
  }
  if (status === 404) {
    return {
      category: "not_found",
      retry: "not retryable as-is",
      hint: "Check the path, the ids in it, and that company_id/project_id point at the right company and project.",
    };
  }
  if (status === 429) {
    return {
      category: "rate_limited",
      retry: "retryable later",
      hint: "Procore's rate limit was still exhausted after the built-in retries. Wait, then retry later.",
    };
  }
  if (status >= 500) {
    return notRetried
      ? { category: "server_error", retry: "check before resending", hint: `Procore returned a server error. ${UNCONFIRMED_WRITE}` }
      : {
          category: "server_error",
          retry: "retryable later",
          hint: "Procore returned a server error after the built-in retries. It is usually transient; retry later.",
        };
  }
  return {
    category: "client_error",
    retry: "not retryable as-is",
    hint: "Procore rejected the request. Read the response body for the reason before changing the call.",
  };
}

/** Procore puts machine codes like TOOL_NOT_ACTIVATED in `code`/`error_code`, sometimes nested. */
export function findProcoreErrorCode(data: unknown, depth = 0): string | undefined {
  if (depth > 3 || data === null || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ["code", "error_code"]) {
    const value = record[key];
    if (typeof value === "string" && /^[A-Z][A-Z0-9_]{2,}$/.test(value)) return value;
  }
  for (const value of Object.values(record)) {
    const found = findProcoreErrorCode(value, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function classifyHttpError(status: number, data: unknown, notice?: string): ErrorClassification {
  const base = classifyStatus(status, notice !== undefined && NOT_RETRIED.test(notice));
  const code = findProcoreErrorCode(data);
  return code ? { ...base, hint: `${base.hint} Procore error code: ${code}.` } : base;
}

export function classifyThrownError(err: unknown): ErrorClassification {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  const unconfirmed = NOT_RETRIED.test(message);

  if (name === LOCAL_VALIDATION_ERROR) {
    return { category: "local_validation", retry: "not retryable as-is", hint: "Fix the tool arguments; no request was sent to Procore." };
  }
  if (/timed out after \d+ ms/.test(message)) {
    return unconfirmed
      ? { category: "timeout", retry: "check before resending", hint: `The request timed out. ${UNCONFIRMED_WRITE}` }
      : {
          category: "timeout",
          retry: "retryable later",
          hint: "Procore did not answer in time, which is usually transient. Retry later, or raise PROCORE_REQUEST_TIMEOUT_MS for slow endpoints.",
        };
  }
  if (/^Procore request failed: /.test(message) || (name === "TypeError" && /fetch failed/.test(message))) {
    return unconfirmed
      ? { category: "network", retry: "check before resending", hint: `The connection to Procore failed. ${UNCONFIRMED_WRITE}` }
      : { category: "network", retry: "retryable later", hint: "Could not reach Procore (transient connectivity). Check the network and retry later." };
  }
  if (/npm run auth|Token (refresh|exchange) failed|Client-credentials token/.test(message)) {
    return {
      category: "auth",
      retry: "not retryable as-is",
      hint: "Could not obtain a valid Procore token. Run `npm run auth`, or check PROCORE_CLIENT_ID/PROCORE_CLIENT_SECRET.",
    };
  }
  if (/^PROCORE_[A-Z_]+ (must|and)/.test(message)) {
    return { category: "config", retry: "not retryable as-is", hint: "Fix the server's environment configuration and restart it." };
  }
  return { category: "unknown", retry: "not retryable as-is", hint: "Unexpected failure; read the message above before retrying." };
}

export function localValidationError(message: string): Error {
  const err = new Error(message);
  err.name = LOCAL_VALIDATION_ERROR;
  return err;
}

/** `{placeholder}`s still in a path after substitution: sending it can only 404. */
export function unresolvedPlaceholders(path: string, pathParams?: Record<string, unknown>): string[] {
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return names.filter((name) => pathParams?.[name] === undefined || pathParams[name] === null);
}

function errorResult(c: ErrorClassification, detail: string): ToolTextResult {
  const text = `Error category: ${c.category} (${c.retry})\n${detail}\n\nSuggestion: ${c.hint}`;
  return { content: [{ type: "text", text }], isError: true };
}

/** An HTTP error result: `responseText` is the handler's usual status/notice/body rendering. */
export function httpErrorResult(status: number, data: unknown, notice: string | undefined, responseText: string): ToolTextResult {
  return errorResult(classifyHttpError(status, data, notice), responseText);
}

export function thrownErrorResult(err: unknown): ToolTextResult {
  const message = err instanceof Error ? err.message : String(err);
  return errorResult(classifyThrownError(err), `Error: ${message}`);
}
