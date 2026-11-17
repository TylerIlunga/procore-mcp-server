# Security

## Credentials

| Secret | Where it lives | Never |
|---|---|---|
| `PROCORE_CLIENT_ID` / `PROCORE_CLIENT_SECRET` | `.env` (gitignored) or the MCP client's env config | committed; logged |
| OAuth access and refresh tokens | `~/.procore-mcp/tokens.json`, file mode `0600`, dir `0700` | inside the repo |
| MCP client config with secrets | `.mcp.json` (gitignored) | committed |

`./scripts/quality-scan.sh` fails CI if `.env`/`.mcp.json` aren't gitignored or a
`tokens.json` is tracked.

## Trust model

- Single user. The server holds one Procore identity and acts with that user's
  permissions. There is no multi-tenant isolation, so don't expose it over a network
  transport without adding auth.
- `procore_api_call` accepts arbitrary paths. Requests always go to the configured
  Procore API base (production or `PROCORE_ENV=sandbox`), never to arbitrary hosts.
- Procore responses are untrusted data passed back to the model. Tool output
  should never be treated as instructions.

## PR checklist

- [ ] No secrets, tokens, or real customer data committed (including test fixtures)
- [ ] New outbound requests go only to Procore hosts
- [ ] Writes and deletes carry accurate MCP annotations (`destructiveHint`, `idempotentHint`)
- [ ] No credential values in error messages or logs
