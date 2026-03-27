import { getValidAccessToken, getApiBaseUrl } from "../auth/oauth.js";
import type { ProcoreApiResponse, ApiCallOptions } from "./types.js";
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

function getDefaultCompanyId(): number | null {
  const id = process.env.PROCORE_COMPANY_ID;
  return id ? parseInt(id, 10) : null;
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
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

export async function procoreApiCall(
  options: ApiCallOptions
): Promise<ProcoreApiResponse> {
  const { method, pathParams, queryParams, body, page, perPage } = options;
  let { path, companyId } = options;

  // Substitute path parameters
  path = substitutePath(path, pathParams);

  // Build full URL
  const qs = buildQueryString(queryParams, page, perPage);
  const url = `${getApiBaseUrl()}${path}${qs}`;

  // Get auth token
  const token = await getValidAccessToken();

  // Build headers
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const effectiveCompanyId = companyId ?? getDefaultCompanyId();
  if (effectiveCompanyId) {
    headers["Procore-Company-Id"] = String(effectiveCompanyId);
  }

  // Wait if rate limited
  await waitForRateLimit();

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const res = await fetch(url, {
        method: method.toUpperCase(),
        headers,
        body:
          body && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())
            ? JSON.stringify(body)
            : undefined,
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
        const retryAfter = res.headers.get("Retry-After");
        const waitSec = retryAfter ? parseInt(retryAfter, 10) : 10;
        rateLimitState.remaining = 0;
        rateLimitState.resetAt = Date.now() + waitSec * 1000;
        if (attempt < MAX_RETRIES) continue;
      }

      // Handle 401 — try token refresh once
      if (res.status === 401 && attempt === 0) {
        const { refreshAccessToken } = await import("../auth/oauth.js");
        try {
          await refreshAccessToken();
          const newToken = await getValidAccessToken();
          headers.Authorization = `Bearer ${newToken}`;
          continue;
        } catch {
          // Refresh failed, return the 401
        }
      }

      // Handle 5xx with retry
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        continue;
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
      };

      return result;
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES) continue;
    }
  }

  throw lastError || new Error("API call failed after retries");
}

// Runtime config store (in-memory, set via procore_set_config tool)
let runtimeConfig: Record<string, string | number> = {};

export function getRuntimeConfig(): Record<string, string | number> {
  return { ...runtimeConfig };
}

export function setRuntimeConfig(
  key: string,
  value: string | number
): void {
  runtimeConfig[key] = value;
}
