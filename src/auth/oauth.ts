import { TokenData, readTokens, writeTokens, isTokenExpired } from "./token-store.js";

function getTokenUrl(): string {
  const env = process.env.PROCORE_ENV || "production";
  if (env === "sandbox") return "https://login-sandbox.procore.com/oauth/token";
  return "https://login.procore.com/oauth/token";
}

export function getAuthBaseUrl(): string {
  const env = process.env.PROCORE_ENV || "production";
  if (env === "sandbox") return "https://login-sandbox.procore.com";
  return "https://login.procore.com";
}

export function getApiBaseUrl(): string {
  const env = process.env.PROCORE_ENV || "production";
  if (env === "sandbox") return "https://sandbox.procore.com";
  return "https://api.procore.com";
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  created_at: number;
}

export type GrantType = "authorization_code" | "client_credentials";

/**
 * Which OAuth grant this process authenticates with.
 * `authorization_code` (default): interactive user login via `npm run auth`, tokens
 * persisted to disk and refreshed with a rotating refresh token.
 * `client_credentials`: app-level token for a Procore Developer Managed Service
 * Account (DMSA). No browser step, nothing persisted; the token is held in memory and
 * re-minted on expiry because the grant issues no refresh token.
 * Any other value is rejected rather than silently falling back.
 */
export function getGrantType(): GrantType {
  const raw = (process.env.PROCORE_GRANT_TYPE || "authorization_code").trim();
  if (raw === "authorization_code" || raw === "client_credentials") return raw;
  throw new Error(
    `PROCORE_GRANT_TYPE must be "authorization_code" or "client_credentials" (got "${raw}")`
  );
}

interface ClientCredentialsResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let appToken: { access_token: string; expires_at: number } | null = null;
type AppToken = { access_token: string; expires_at: number };
let appTokenInFlight: Promise<AppToken> | null = null;

async function mintClientCredentialsToken(): Promise<AppToken> {
  const { clientId, clientSecret } = getClientCredentials();

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(getTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Client-credentials token request failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as ClientCredentialsResponse;
  if (!data.access_token || !data.expires_in) {
    throw new Error("Client-credentials token response missing access_token or expires_in");
  }
  // Local clock + expires_in, not created_at: immune to clock skew with Procore.
  const minted: AppToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  appToken = minted;
  return minted;
}

/** Mint (or re-mint) the app token; concurrent callers share one request. */
function acquireClientCredentialsToken(): Promise<AppToken> {
  appTokenInFlight ??= mintClientCredentialsToken().finally(() => {
    appTokenInFlight = null;
  });
  return appTokenInFlight;
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.PROCORE_CLIENT_ID;
  const clientSecret = process.env.PROCORE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "PROCORE_CLIENT_ID and PROCORE_CLIENT_SECRET environment variables are required"
    );
  }
  return { clientId, clientSecret };
}

function tokenResponseToData(resp: TokenResponse): TokenData {
  return {
    access_token: resp.access_token,
    refresh_token: resp.refresh_token,
    expires_at: (resp.created_at + resp.expires_in) * 1000, // Convert to ms
  };
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<TokenData> {
  const { clientId, clientSecret } = getClientCredentials();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(getTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as TokenResponse;
  const tokens = tokenResponseToData(data);
  writeTokens(tokens);
  return tokens;
}

export async function refreshAccessToken(): Promise<TokenData> {
  if (getGrantType() === "client_credentials") {
    // No refresh token exists for this grant: discard the cached token and re-mint.
    appToken = null;
    const minted = await acquireClientCredentialsToken();
    // Callers (api/client.ts 401 path) only need the cache refreshed; return shape
    // is kept for the authorization_code contract.
    return { ...minted, refresh_token: "" };
  }

  const current = readTokens();
  if (!current) {
    throw new Error(
      "No tokens found. Run 'npm run auth' to authenticate with Procore."
    );
  }

  const { clientId, clientSecret } = getClientCredentials();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: current.refresh_token,
  });

  const res = await fetch(getTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 400) {
      throw new Error(
        `Token refresh failed — re-authentication required. Run 'npm run auth' to re-authenticate.\nDetails: ${text}`
      );
    }
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as TokenResponse;
  const tokens = tokenResponseToData(data);
  writeTokens(tokens); // Procore rotates refresh tokens, must persist new one
  return tokens;
}

export async function getValidAccessToken(): Promise<string> {
  if (getGrantType() === "client_credentials") {
    // 60-second buffer, same as isTokenExpired for the authorization_code path.
    if (appToken && Date.now() < appToken.expires_at - 60_000) {
      return appToken.access_token;
    }
    return (await acquireClientCredentialsToken()).access_token;
  }

  let tokens = readTokens();
  if (!tokens) {
    throw new Error(
      "No Procore tokens found. Run 'npm run auth' to authenticate."
    );
  }

  if (isTokenExpired(tokens)) {
    tokens = await refreshAccessToken();
  }

  return tokens.access_token;
}
