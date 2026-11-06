/**
 * Auth invariants, with `fetch` and the clock mocked (no network, no credentials).
 * Run by `npm test`.
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTokens, writeTokens } from "../src/auth/token-store.js";

const TOKEN_PATH = join(tmpdir(), `procore-mcp-verify-auth-${process.pid}.json`);
process.env.PROCORE_ENV = "sandbox";
process.env.PROCORE_CLIENT_ID = "test-id";
process.env.PROCORE_CLIENT_SECRET = "test-secret";
process.env.PROCORE_TOKEN_PATH = TOKEN_PATH;

type Call = { url: string; method?: string; contentType?: string | null; body: URLSearchParams };
let calls: Call[] = [];
let responder: () => Response = () => new Response("unset", { status: 500 });

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({
    url: String(url),
    method: init?.method,
    contentType: new Headers(init?.headers).get("content-type"),
    body: new URLSearchParams(String(init?.body ?? "")),
  });
  return responder();
}) as typeof fetch;

// Controllable clock.
const realNow = Date.now.bind(Date);
let skewMs = 0;
Date.now = () => realNow() + skewMs;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const ok = (token: string, expiresIn = 5400) => () =>
  json({ access_token: token, token_type: "Bearer", expires_in: expiresIn, scope: "procore_all" });

// Fresh module (and fresh in-memory token cache) per case.
let n = 0;
const load = async () => (await import(`../src/auth/oauth.js?case=${n++}`)) as typeof import("../src/auth/oauth.js");

async function main(): Promise<void> {
  // ---- environment selection ----
  delete process.env.PROCORE_GRANT_TYPE;
  let oauth = await load();
  const hosts: Array<[string | undefined, string, string]> = [
    [undefined, "https://login.procore.com", "https://api.procore.com"], // unset stays production
    ["", "https://login.procore.com", "https://api.procore.com"],
    ["production", "https://login.procore.com", "https://api.procore.com"],
    ["sandbox", "https://login-sandbox.procore.com", "https://sandbox.procore.com"],
    ["Sandbox ", "https://login-sandbox.procore.com", "https://sandbox.procore.com"], // case/space-insensitive
    ["sandbox-monthly", "https://login-sandbox-monthly.procore.com", "https://api-monthly.procore.com"],
  ];
  for (const [value, auth, api] of hosts) {
    if (value === undefined) delete process.env.PROCORE_ENV;
    else process.env.PROCORE_ENV = value;
    assert.equal(oauth.getAuthBaseUrl(), auth, `auth host for PROCORE_ENV=${JSON.stringify(value)}`);
    assert.equal(oauth.getApiBaseUrl(), api, `api host for PROCORE_ENV=${JSON.stringify(value)}`);
  }
  // An unrecognized value must fail, never fall through to production.
  for (const bad of ["qa", "prod", "sandbx"]) {
    process.env.PROCORE_ENV = bad;
    assert.throws(() => oauth.getApiBaseUrl(), /PROCORE_ENV must be one of/, `value "${bad}" must be rejected`);
    assert.throws(() => oauth.getAuthBaseUrl(), /PROCORE_ENV must be one of/);
  }
  process.env.PROCORE_ENV = "sandbox";

  // ---- grant selection ----
  assert.equal(oauth.getGrantType(), "authorization_code", "default grant");
  process.env.PROCORE_GRANT_TYPE = "";
  assert.equal(oauth.getGrantType(), "authorization_code", "empty value means default");
  process.env.PROCORE_GRANT_TYPE = " client_credentials ";
  assert.equal(oauth.getGrantType(), "client_credentials", "value is trimmed");
  process.env.PROCORE_GRANT_TYPE = "password";
  assert.throws(() => oauth.getGrantType(), /must be "authorization_code" or "client_credentials"/);
  delete process.env.PROCORE_GRANT_TYPE;

  // ---- authorization_code (default) path is unchanged ----
  oauth = await load();
  calls = [];
  assert.equal(existsSync(TOKEN_PATH), false);
  await assert.rejects(oauth.getValidAccessToken(), /Run 'npm run auth'/);
  assert.equal(calls.length, 0, "no token file must not hit the network");

  writeTokens({ access_token: "ac-valid", refresh_token: "rt-1", expires_at: Date.now() + 3_600_000 });
  assert.equal(await oauth.getValidAccessToken(), "ac-valid");
  assert.equal(calls.length, 0, "a valid stored token is returned without a request");

  writeTokens({ access_token: "ac-old", refresh_token: "rt-1", expires_at: Date.now() - 1000 });
  responder = () =>
    json({ access_token: "ac-new", refresh_token: "rt-2", token_type: "Bearer", expires_in: 5400, created_at: Math.floor(Date.now() / 1000) });
  assert.equal(await oauth.getValidAccessToken(), "ac-new");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.get("grant_type"), "refresh_token");
  assert.equal(calls[0].body.get("refresh_token"), "rt-1");
  assert.equal(readTokens()?.refresh_token, "rt-2", "rotated refresh token is persisted");
  rmSync(TOKEN_PATH, { force: true });

  // ---- client_credentials: request shape, cache, nothing persisted ----
  process.env.PROCORE_GRANT_TYPE = "client_credentials";
  oauth = await load();
  calls = [];
  responder = ok("tok-1");
  assert.equal(await oauth.getValidAccessToken(), "tok-1");
  assert.equal(await oauth.getValidAccessToken(), "tok-1");
  assert.equal(calls.length, 1, "second call must hit the in-memory cache");
  assert.equal(calls[0].url, "https://login-sandbox.procore.com/oauth/token");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].contentType, "application/x-www-form-urlencoded");
  assert.equal(calls[0].body.get("grant_type"), "client_credentials");
  assert.equal(calls[0].body.get("client_id"), "test-id");
  assert.equal(calls[0].body.get("client_secret"), "test-secret");
  assert.equal(calls[0].body.get("refresh_token"), null);
  assert.equal(existsSync(TOKEN_PATH), false, "client_credentials must not write a token file");

  // Token endpoint follows the selected environment, including production.
  for (const [env, url] of [
    ["production", "https://login.procore.com/oauth/token"],
    ["sandbox-monthly", "https://login-sandbox-monthly.procore.com/oauth/token"],
  ] as const) {
    process.env.PROCORE_ENV = env;
    oauth = await load();
    calls = [];
    responder = ok("t");
    await oauth.getValidAccessToken();
    assert.equal(calls[0].url, url);
  }
  process.env.PROCORE_ENV = "sandbox";

  // ---- concurrency: callers share one mint, including refresh ----
  oauth = await load();
  calls = [];
  responder = ok("tok-2");
  const got = await Promise.all([oauth.getValidAccessToken(), oauth.getValidAccessToken(), oauth.getValidAccessToken()]);
  assert.deepEqual(got, ["tok-2", "tok-2", "tok-2"]);
  assert.equal(calls.length, 1, "concurrent callers must share one request");

  oauth = await load();
  calls = [];
  responder = ok("tok-3");
  await Promise.all([oauth.refreshAccessToken(), oauth.refreshAccessToken()]);
  assert.equal(calls.length, 1, "concurrent refreshes must share one request");

  // ---- expiry buffer is exactly 60s ----
  oauth = await load();
  calls = [];
  skewMs = 0;
  responder = ok("buf-1", 5400);
  await oauth.getValidAccessToken();
  skewMs = (5400 - 60.5) * 1000; // 60.5s left: still cached
  assert.equal(await oauth.getValidAccessToken(), "buf-1");
  assert.equal(calls.length, 1, "60.5s before expiry must still use the cache");
  skewMs = (5400 - 59.5) * 1000; // 59.5s left: inside the buffer
  responder = ok("buf-2", 5400);
  assert.equal(await oauth.getValidAccessToken(), "buf-2");
  assert.equal(calls.length, 2, "59.5s before expiry must re-mint");
  skewMs = 0;

  // ---- refreshAccessToken (the client.ts 401 path) ----
  oauth = await load();
  calls = [];
  responder = ok("a");
  await oauth.getValidAccessToken();
  responder = ok("b");
  await oauth.refreshAccessToken();
  assert.equal(await oauth.getValidAccessToken(), "b");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.get("grant_type"), "client_credentials");

  // A failed refresh must not leave the rejected token cached.
  oauth = await load();
  responder = ok("stale");
  await oauth.getValidAccessToken();
  responder = () => new Response("down", { status: 503 });
  await assert.rejects(oauth.refreshAccessToken(), /failed \(503\)/);
  responder = ok("fresh-after-failure");
  assert.equal(await oauth.getValidAccessToken(), "fresh-after-failure");

  // ---- failures ----
  oauth = await load();
  responder = () => new Response('{"error":"invalid_client"}', { status: 401 });
  await assert.rejects(oauth.getValidAccessToken(), /failed \(401\).*invalid_client/);
  responder = ok("recovered");
  assert.equal(await oauth.getValidAccessToken(), "recovered", "a failed mint must not wedge later attempts");

  responder = () => new Response("x".repeat(5000), { status: 500 });
  oauth = await load();
  await assert.rejects(oauth.getValidAccessToken(), (e: Error) => e.message.length < 400, "echoed body is truncated");

  // A 200 with an unusable body must be rejected, not cached.
  for (const bad of [{ token_type: "Bearer", expires_in: 5400 }, { access_token: "x" }, { access_token: "x", expires_in: "soon" }, { access_token: "x", expires_in: 0 }]) {
    oauth = await load();
    responder = () => json(bad);
    await assert.rejects(oauth.getValidAccessToken(), /missing access_token or expires_in/, JSON.stringify(bad));
  }

  console.log("verify-auth: all invariants hold");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => rmSync(TOKEN_PATH, { force: true }));
