import { getValidAccessToken, getApiBaseUrl } from "../auth/oauth.js";
import { defaultCompanyId, withContextDefaults } from "./request-context.js";
import type { ProcoreApiResponse, ApiCallOptions } from "./types.js";
import { getRequestTimeoutMs, isTimeoutError } from "./request-timeout.js";
import { isRetryable, notRetriedNotice } from "./retry-policy.js";
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

type DelayFn = (ms: number) => Promise<void>;
const realDelay: DelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let delay: DelayFn = realDelay;

/**
 * Replace the wait used for backoff and rate limiting. Tests pass an instant
 * function so retry paths run without real-time waits; pass nothing to restore.
 */
export function setDelayFn(fn?: DelayFn): void {
  delay = fn ?? realDelay;
}


// In-memory rate limit state
let rateLimitState = {
  remaining: Infinity,
  limit: 0,
  resetAt: 0,
};

function parseLinkHeader(
  header: string | null
): { next?: string; total?: string } {
  if (!header) return {};
  const result: Record<string, string> = {};
  const parts = header.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="(\w+)"/);
    if (match) result[match[2]] = match[1];
  }
  return result;
}

function substitutePath(
  path: string,
  params?: Record<string, string>
): string {
  if (!params) return path;
  let result = path;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`{${key}}`, encodeURIComponent(value));
  }
  return result;
}

function buildQueryString(
  params?: Record<string, string | number | boolean>,
  page?: number,
  perPage?: number
): string {
  const qs = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (key.includes("__")) {
        // Convert filters__field back to filters[field]
        const parts = key.split("__");
        const converted = parts[0] + "[" + parts.slice(1).join("][") + "]";
        qs.set(converted, String(value));
      } else {
        qs.set(key, String(value));
      }
    }
  }
  if (page !== undefined) qs.set("page", String(page));
  if (perPage !== undefined) qs.set("per_page", String(perPage));
  const str = qs.toString();
  return str ? `?${str}` : "";
}

async function waitForRateLimit(): Promise<void> {
  if (rateLimitState.remaining <= 0 && rateLimitState.resetAt > Date.now()) {
    const waitMs = rateLimitState.resetAt - Date.now() + 100;
    console.error(
      `Rate limited. Waiting ${(waitMs / 1000).toFixed(1)}s...`
    );
    await delay(waitMs);
  }
}

export async function procoreApiCall(
  options: ApiCallOptions
): Promise<ProcoreApiResponse> {
  const { method, pathParams, queryParams, body, page, perPage } = options;
  let { path, companyId } = options;

  // Substitute path parameters, filling company_id / project_id from the
  // procore_set_config session defaults when the caller left them out.
  path = substitutePath(path, withContextDefaults(path, pathParams));

  // Build full URL
  const qs = buildQueryString(queryParams, page, perPage);
  const url = `${getApiBaseUrl()}${path}${qs}`;

  // Validated on every call (and at startup in src/index.ts): a bad value throws.
  const timeoutMs = getRequestTimeoutMs();
  const verb = method.toUpperCase();

  // Get auth token
  const token = await getValidAccessToken();

  // Build headers
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const effectiveCompanyId = companyId ?? defaultCompanyId();
  if (effectiveCompanyId) {
    headers["Procore-Company-Id"] = String(effectiveCompanyId);
  }

  // Which failures may be re-sent is decided by retry-policy.ts: 5xx, timeouts
  // and network errors only for idempotent methods; 429 and 401 for all.
  let lastError: Error | null = null;
  let backoffMs = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Before every attempt, so a 429's Retry-After is honoured on the retry.
    await waitForRateLimit();
    if (backoffMs > 0) await delay(backoffMs);
    // Exponential backoff before the next attempt if this one fails transiently.
    backoffMs = RETRY_BASE_MS * Math.pow(2, attempt);
    const canRetry = attempt < MAX_RETRIES;

    try {
      // The signal also bounds reading the body below, not just the headers.
      const res = await fetch(url, {
        method: verb,
        headers,
        body:
          body && ["POST", "PUT", "PATCH"].includes(verb)
            ? JSON.stringify(body)
            : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      // Update rate limit state
      const rlRemaining = res.headers.get("X-Rate-Limit-Remaining");
      const rlLimit = res.headers.get("X-Rate-Limit-Limit");
      const rlReset = res.headers.get("X-Rate-Limit-Reset");
      if (rlRemaining !== null) {
        rateLimitState = {
          remaining: parseInt(rlRemaining, 10),
          limit: rlLimit ? parseInt(rlLimit, 10) : rateLimitState.limit,
          resetAt: rlReset ? parseInt(rlReset, 10) * 1000 : rateLimitState.resetAt,
        };
      }

      // Handle 429 rate limit
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "", 10);
        const waitSec = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 10;
        rateLimitState.remaining = 0;
        rateLimitState.resetAt = Date.now() + waitSec * 1000;
        if (canRetry && isRetryable(verb, "rate_limited")) {
          backoffMs = 0; // waitForRateLimit already waits out Retry-After
          continue;
        }
      }

      // Handle 401 — try token refresh once
      if (res.status === 401 && attempt === 0) {
        const { refreshAccessToken } = await import("../auth/oauth.js");
        try {
          await refreshAccessToken();
          const newToken = await getValidAccessToken();
          headers.Authorization = `Bearer ${newToken}`;
          backoffMs = 0;
          continue;
        } catch {
          // Refresh failed, return the 401
        }
      }

      // 5xx: the request may have executed, so only idempotent methods retry.
      let notice: string | undefined;
      if (res.status >= 500) {
        if (!isRetryable(verb, "server_error")) notice = notRetriedNotice(verb);
        else if (canRetry) continue;
      }

      // Parse response
      const contentType = res.headers.get("content-type") || "";
      let data: unknown;
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        data = await res.text();
      }

      // Parse pagination from Link header
      const linkHeader = res.headers.get("Link");
      const totalHeader = res.headers.get("Total");
      const perPageHeader = res.headers.get("Per-Page");
      const links = parseLinkHeader(linkHeader);

      const pagination =
        linkHeader || totalHeader
          ? {
              current_page: page || 1,
              per_page: perPageHeader
                ? parseInt(perPageHeader, 10)
                : perPage || 20,
              has_next: !!links.next,
              total: totalHeader ? parseInt(totalHeader, 10) : undefined,
            }
          : undefined;

      const result: ProcoreApiResponse = {
        status: res.status,
        data,
        pagination,
        rate_limit: {
          remaining: rateLimitState.remaining,
          limit: rateLimitState.limit,
          reset_at: rateLimitState.resetAt,
        },
        ...(notice ? { notice } : {}),
      };

      return result;
    } catch (err) {
      // A timeout is transient, like a dropped connection: same retry rule.
      const timedOut = isTimeoutError(err);
      lastError = timedOut
        ? new Error(`Procore request timed out after ${timeoutMs} ms: ${verb} ${path}`)
        : new Error(`Procore request failed: ${verb} ${path}: ${(err as Error).message}`, {
            cause: err,
          });
      if (!isRetryable(verb, timedOut ? "timeout" : "network_error")) {
        throw new Error(`${lastError.message}. ${notRetriedNotice(verb)}`, { cause: err });
      }
      if (canRetry) continue;
    }
  }

  throw new Error(
    `${lastError?.message ?? `Procore request failed: ${verb} ${path}`} ` +
      `(gave up after ${MAX_RETRIES + 1} attempts)`,
    { cause: lastError }
  );
}

// The procore_set_config store lives in request-context.ts, next to the
// fallback logic that reads it; re-exported for existing importers.
export { getRuntimeConfig, setRuntimeConfig } from "./request-context.js";
