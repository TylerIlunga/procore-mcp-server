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
