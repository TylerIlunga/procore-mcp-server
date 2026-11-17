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

- Access tokens refresh automatically when they expire.
- Procore **rotates refresh tokens**, so each refresh persists the new pair at once
  (`writeTokens`). Losing it forces a re-auth.
- If the refresh token is rejected, the error tells the user to run `npm run auth`.

## Startup

The server exits with a clear stderr message when credentials or tokens are
missing. It never starts half-configured.

## Logging

stdout is the MCP protocol channel, so all diagnostics go to **stderr**
(`console.error`). `./scripts/quality-scan.sh` fails CI on stdout writes in
server code.

## Known gaps

See [QUALITY.md](./QUALITY.md#known-gaps): there is no per-request timeout yet.
