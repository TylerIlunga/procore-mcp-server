/**
 * Auth-grant invariants, with `fetch` mocked (no network, no credentials).
 * Run by `npm test`.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TOKEN_PATH = join(tmpdir(), `procore-mcp-verify-auth-${process.pid}.json`);
process.env.PROCORE_ENV = "sandbox";
process.env.PROCORE_CLIENT_ID = "test-id";
process.env.PROCORE_CLIENT_SECRET = "test-secret";
process.env.PROCORE_TOKEN_PATH = TOKEN_PATH;

type Call = { url: string; body: URLSearchParams };
let calls: Call[] = [];
let responder: () => Response = () => new Response("unset", { status: 500 });

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(url), body: new URLSearchParams(String(init?.body ?? "")) });
  return responder();
}) as typeof fetch;

const ok = (token: string, expiresIn = 5400) => () =>
  new Response(
    JSON.stringify({ access_token: token, token_type: "Bearer", expires_in: expiresIn, scope: "procore_all" }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

// Fresh module (and fresh in-memory token cache) per case.
let n = 0;
const load = async () => (await import(`../src/auth/oauth.js?case=${n++}`)) as typeof import("../src/auth/oauth.js");

async function main(): Promise<void> {
  // 1. Default grant is unchanged: authorization_code, and with no token file it
  //    fails the old way without touching the network. (negative control)
  delete process.env.PROCORE_GRANT_TYPE;
  calls = [];
  let oauth = await load();
  assert.equal(oauth.getGrantType(), "authorization_code");
  await assert.rejects(oauth.getValidAccessToken(), /Run 'npm run auth'/);
  assert.equal(calls.length, 0, "authorization_code path must not call the token endpoint here");

  // 2. Unknown grant value is rejected, not silently defaulted.
  process.env.PROCORE_GRANT_TYPE = "password";
  oauth = await load();
  assert.throws(() => oauth.getGrantType(), /must be "authorization_code" or "client_credentials"/);

  // 3. client_credentials: correct request, cached, nothing persisted.
  process.env.PROCORE_GRANT_TYPE = "client_credentials";
  oauth = await load();
  calls = [];
  responder = ok("tok-1");
  assert.equal(await oauth.getValidAccessToken(), "tok-1");
  assert.equal(await oauth.getValidAccessToken(), "tok-1");
  assert.equal(calls.length, 1, "second call must hit the in-memory cache");
  assert.equal(calls[0].url, "https://login-sandbox.procore.com/oauth/token");
  assert.equal(calls[0].body.get("grant_type"), "client_credentials");
  assert.equal(calls[0].body.get("client_id"), "test-id");
  assert.equal(calls[0].body.get("client_secret"), "test-secret");
  assert.equal(calls[0].body.get("refresh_token"), null);
  assert.equal(existsSync(TOKEN_PATH), false, "client_credentials must not write a token file");

  // 4. Concurrent callers share one mint.
  oauth = await load();
  calls = [];
  responder = ok("tok-2");
  const got = await Promise.all([oauth.getValidAccessToken(), oauth.getValidAccessToken(), oauth.getValidAccessToken()]);
  assert.deepEqual(got, ["tok-2", "tok-2", "tok-2"]);
  assert.equal(calls.length, 1, "concurrent callers must share one request");

  // 5. A token inside the 60s expiry buffer is re-minted.
  oauth = await load();
  calls = [];
  responder = ok("short", 30);
  assert.equal(await oauth.getValidAccessToken(), "short");
  responder = ok("fresh");
  assert.equal(await oauth.getValidAccessToken(), "fresh");
  assert.equal(calls.length, 2);

  // 6. refreshAccessToken (the client.ts 401 path) discards the cache and re-mints,
  //    with grant_type client_credentials, never refresh_token.
  oauth = await load();
  calls = [];
  responder = ok("a");
  await oauth.getValidAccessToken();
  responder = ok("b");
  await oauth.refreshAccessToken();
  assert.equal(await oauth.getValidAccessToken(), "b");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.get("grant_type"), "client_credentials");

  // 7. Failure carries the status and does not poison later attempts.
  oauth = await load();
  calls = [];
  responder = () => new Response('{"error":"invalid_client"}', { status: 401 });
  await assert.rejects(oauth.getValidAccessToken(), /failed \(401\).*invalid_client/);
  responder = ok("recovered");
  assert.equal(await oauth.getValidAccessToken(), "recovered");

  console.log("verify-auth: all invariants hold");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
