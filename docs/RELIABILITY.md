# Reliability

How the server behaves when Procore or the network misbehaves. Source:
`src/api/client.ts` and `src/auth/oauth.ts`.

## HTTP client

Retry safety depends on the method (`src/api/retry-policy.ts`). A 5xx, a timeout
or a dropped connection does not tell us whether Procore applied the request, so
only **idempotent** methods (`GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`) are re-sent.
`POST` and `PATCH` are not: a retry could create a duplicate or apply a change twice.

| Condition | Idempotent methods | `POST`, `PATCH` |
|---|---|---|
| `429 Too Many Requests` | Waits out `Retry-After` (default 10s), then retries, up to `MAX_RETRIES` (3) | Same: Procore rejected the request without executing it |
| `401 Unauthorized` | Refreshes the access token once and retries | Same: the request was not executed |
| `5xx` | Retries with exponential backoff from `RETRY_BASE_MS` (1s, 2s, 4s), up to 3 times, then returns the last response | Returned at once, with a notice that it was not retried because the method is not idempotent and Procore may already have applied it |
| Timeout | Retried with the same backoff. Once retries run out, the error says `timed out after N ms` with the method and path, so it reads differently from an HTTP error | Fails at once with the same timeout message plus the not-retried notice |
| Network error | Retried with the same backoff. The exhausted error names the method, path and underlying cause | Fails at once with the cause plus the not-retried notice |
| Other `4xx` | Not retried. The status and Procore's error body go back to the caller | Same |
| Rate-limit headers | Tracked in memory (`remaining`, `limit`, `resetAt`). When `remaining` hits 0, the next attempt waits until `resetAt` | Same |

Every request carries `AbortSignal.timeout(PROCORE_REQUEST_TIMEOUT_MS)` (default
30000 ms), which bounds the headers and the body read. Worst case for an idempotent
call that keeps timing out: 4 attempts x the timeout, plus 7s of backoff.

## Session defaults (`procore_set_config`)

`company_id` and `project_id` in a path may be omitted by the caller; the server
fills them from `src/api/request-context.ts`. Precedence: explicit argument, then
the value set with `procore_set_config`, then `PROCORE_COMPANY_ID` (company only).
The `Procore-Company-Id` header follows the same order. Generated tools mark those
two path ids optional in their schemas for this reason. If a value is still
missing, the call is rejected locally, before any request, with a hint naming
`procore_set_config`. Verified by `scripts/verify-config-fallback.ts`.

## Error results

Both `procore_call_api` and the per-endpoint tools build failures through
`src/tools/error-hints.ts`, so the two can't drift. Any Procore response with
status >= 400, and any thrown failure, comes back with `isError: true`. A 2xx is
a success even when the body is empty (`[]` means nothing matched; it is not a
failure). An error result opens with a machine-readable line, then the usual
status, notice and Procore body, then a `Suggestion:` for the category:

```
Error category: permission (not retryable as-is)
Status: 403
...
Suggestion: The Procore user or service account lacks permission ... Procore error code: TOOL_NOT_ACTIVATED.
```

| Category | Cause | Recovery hint |
|---|---|---|
| `validation` | 400, 422 | Check params and body against `procore_get_endpoint_details` |
| `auth` | 401 after the one refresh, or no usable token | `npm run auth`, or check the client credentials |
| `permission` | 403 | Missing permission or the tool isn't enabled; Procore's `code` (e.g. `TOOL_NOT_ACTIVATED`) is named |
| `not_found` | 404 | Check the path, the ids, and company_id/project_id |
| `rate_limited` | 429 after retries | Wait and retry later |
| `server_error` | 5xx | Transient, retry later. POST/PATCH (not retried): check whether the write landed before resending |
| `client_error` | other 4xx | Read Procore's body |
| `timeout` | `timed out after N ms` | Transient, retry later or raise `PROCORE_REQUEST_TIMEOUT_MS`. POST/PATCH: check first |
| `network` | connection failed | Transient connectivity. POST/PATCH: check first |
| `local_validation` | bad arguments, e.g. an unfilled `{placeholder}` in the path | Fix the input; nothing was sent |
| `config` | invalid `PROCORE_*` environment | Fix the configuration and restart |

The retry label is one of `not retryable as-is`, `retryable later` or
`check before resending`. `scripts/verify-tool-errors.ts` covers this.

## Tokens

The behavior depends on `PROCORE_GRANT_TYPE`.

**`authorization_code` (default, user login)**
- Access tokens refresh automatically when they expire (60s buffer).
- Procore **rotates refresh tokens**, so each refresh persists the new pair at once
  (`writeTokens`). Losing it forces a re-auth.
- If the refresh token is rejected, the error tells the user to run `npm run auth`.

**`client_credentials` (service account / DMSA app)**
- The token is minted at startup, so bad credentials fail before the server accepts calls.
- It is held in memory only. The grant issues no refresh token, so the server re-mints
  on expiry (60s buffer) and on a `401`.
- Concurrent callers share one in-flight mint.
- A failed mint or refresh clears the cached token, so the next call retries cleanly
  instead of reusing a rejected token.
- A token response without a usable `access_token`/`expires_in` is rejected, not cached.

## Startup

The server exits with a clear stderr message, before any tool call is accepted, when:
- `PROCORE_CLIENT_ID`/`PROCORE_CLIENT_SECRET` are missing
- `PROCORE_ENV` is not `production`, `sandbox`, or `sandbox-monthly`
- `PROCORE_GRANT_TYPE` is not `authorization_code` or `client_credentials`
- `PROCORE_REQUEST_TIMEOUT_MS` is set but is not a positive integer (1 to 2147483647)
- `authorization_code`: no token file exists. `client_credentials`: the startup mint fails

It logs the resolved environment and API host on start. It never starts half-configured.

## Logging

stdout is the MCP protocol channel, so all diagnostics go to **stderr**
(`console.error`). `./scripts/quality-scan.sh` fails CI on stdout writes in
server code.

## Known gaps

See [QUALITY.md](./QUALITY.md#known-gaps). Timeouts and the retry and refresh
paths are covered by `scripts/verify-client.ts` (`npm test`).
