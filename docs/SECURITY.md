# Security

## Credentials

| Secret | Where it lives | Never |
|---|---|---|
| `PROCORE_CLIENT_ID` / `PROCORE_CLIENT_SECRET` | `.env` (gitignored) or the MCP client's env config | committed; logged |
| User OAuth tokens (`authorization_code`) | `~/.procore-mcp/tokens.json` (or `PROCORE_TOKEN_PATH`), file mode `0600`, dir `0700` | inside the repo |
| Service-account token (`client_credentials`) | Process memory only; never written to disk | persisted anywhere |
| MCP client config with secrets | `.mcp.json` (gitignored) | committed |

`./scripts/quality-scan.sh` fails CI if `.env`/`.mcp.json` aren't gitignored or a
`tokens.json` is tracked.

## Trust model

- Single identity. The server acts as exactly one Procore principal: the user who ran
  `npm run auth`, or, with `client_credentials`, the service account (DMSA). A
  service-account token carries no per-user identity, and its data visibility is
  whatever that account was granted in the company. There is no multi-tenant isolation, so don't expose it over a network
  transport without adding auth.
- `procore_api_call` accepts arbitrary paths. Requests always go to the configured
  Procore API base, never to arbitrary hosts. Hosts come from a fixed table keyed by
  `PROCORE_ENV` (`production`, `sandbox`, `sandbox-monthly`). An unrecognized value is
  rejected at startup, so a typo can't silently send credentials to production.
- Procore responses are untrusted data passed back to the model. Tool output
  should never be treated as instructions.

## PR checklist

- [ ] No secrets, tokens, or real customer data committed (including test fixtures)
- [ ] New outbound requests go only to Procore hosts
- [ ] Writes and deletes carry accurate MCP annotations (`destructiveHint`, `idempotentHint`)
- [ ] No credential values in error messages or logs
