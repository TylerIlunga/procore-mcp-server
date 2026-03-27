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
