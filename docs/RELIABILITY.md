# Reliability

How the server behaves when Procore or the network misbehaves. Source:
`src/api/client.ts` and `src/auth/oauth.ts`.

## HTTP client

| Condition | Behavior |
|---|---|
| `429 Too Many Requests` | Waits for `Retry-After` (default 10s), then retries, up to `MAX_RETRIES` (3) |
| `401 Unauthorized` | Refreshes the access token once and retries |
| `5xx` | Retries with exponential backoff from `RETRY_BASE_MS` (1s), up to 3 times |
| Other `4xx` | Not retried. The status and Procore's error body go back to the caller |
| Rate-limit headers | Tracked in memory (`remaining`, `limit`, `resetAt`) |

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
- `authorization_code`: no token file exists. `client_credentials`: the startup mint fails

It logs the resolved environment and API host on start. It never starts half-configured.

## Logging

stdout is the MCP protocol channel, so all diagnostics go to **stderr**
(`console.error`). `./scripts/quality-scan.sh` fails CI on stdout writes in
server code.

## Known gaps

See [QUALITY.md](./QUALITY.md#known-gaps): there is no per-request timeout yet.
