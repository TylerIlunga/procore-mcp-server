import { createServer, IncomingMessage, ServerResponse } from "http";
import { exchangeCodeForTokens } from "./oauth.js";
import { getAuthBaseUrl, getApiBaseUrl } from "./oauth.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env manually (no dotenv dependency)
function loadEnv(): void {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const envPath = join(__dir, "..", "..", ".env");
  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file not found, rely on existing env vars
  }
}

// Procore only allows http://localhost as non-HTTPS redirect URI
// We listen on port 80 (requires no special perms on modern macOS)
const PORT = 80;
const REDIRECT_URI = "http://localhost";

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><title>Procore Auth Success</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff}
.card{text-align:center;padding:2rem;border-radius:12px;background:#1a1a1a;border:1px solid #333}
h1{color:#4ade80;margin:0 0 .5rem}p{color:#999;margin:0}</style></head>
<body><div class="card"><h1>Authenticated</h1><p>Procore tokens saved. You can close this tab.</p></div></body>
</html>`;

async function main(): Promise<void> {
  loadEnv();

  const clientId = process.env.PROCORE_CLIENT_ID;
  const clientSecret = process.env.PROCORE_CLIENT_SECRET;
  const env = process.env.PROCORE_ENV || "production";

  if (!clientId || !clientSecret) {
    console.error(
      "Missing PROCORE_CLIENT_ID and/or PROCORE_CLIENT_SECRET.\n" +
        "Copy .env.example to .env and fill in your Procore OAuth credentials."
    );
    process.exit(1);
  }

  const authBase = getAuthBaseUrl();
  const apiBase = getApiBaseUrl();
  const authUrl =
    `${authBase}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  console.log(`Environment: ${env}`);
  console.log(`Auth base: ${authBase}`);
  console.log(`API base: ${apiBase}`);
  console.log(`Redirect URI: ${REDIRECT_URI}`);
  console.log("");

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "/", `http://localhost:${PORT}`);

      // Procore redirects to http://localhost?code=XXX (root path with query params)
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Auth Error</h1><p>${error}</p>`);
        console.error(`Auth error: ${error}`);
        shutdown(1);
        return;
      }

      if (code) {
        try {
          console.log("Exchanging authorization code for tokens...");
          const tokens = await exchangeCodeForTokens(code, REDIRECT_URI);

          // Verify by calling /me
          const meRes = await fetch(`${apiBase}/rest/v1.0/me`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });

          if (meRes.ok) {
            const me = (await meRes.json()) as { login: string; name: string };
            console.log(`\nAuthenticated as: ${me.name} (${me.login})`);
          } else {
            console.log(`\n/me check returned ${meRes.status} (tokens still saved)`);
          }

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(SUCCESS_HTML);

          console.log("Tokens saved to ~/.procore-mcp/tokens.json");
          console.log("\nYou can now start the MCP server with: npm start");
          shutdown(0);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`<h1>Error</h1><p>${(err as Error).message}</p>`);
          console.error("Token exchange failed:", (err as Error).message);
          shutdown(1);
        }
        return;
      }

      // No code — show waiting page or redirect manually
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><head><title>Procore Auth</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff}
.card{text-align:center;padding:2rem;border-radius:12px;background:#1a1a1a;border:1px solid #333}
h1{margin:0 0 .5rem}p{color:#999;margin:0}</style></head>
<body><div class="card"><h1>Waiting for Procore...</h1><p>Complete the login in the Procore window.</p></div></body></html>`);
    }
  );

  function shutdown(code: number): void {
    setTimeout(() => {
      server.close();
      process.exit(code);
    }, 1000);
  }

  server.listen(PORT, () => {
    console.log(`Callback server listening on port ${PORT}`);
    console.log(`Opening browser to authorize...\n`);

    // Open browser (macOS)
    import("child_process").then(({ exec }) => {
      exec(`open "${authUrl}"`);
    });
  });

  // Handle port 80 permission error
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EACCES") {
      console.error(
        `\nPort ${PORT} requires elevated permissions.\n` +
          "Run with: sudo npm run auth\n" +
          "Or run: sudo tsx src/auth/setup.ts"
      );
      process.exit(1);
    }
    throw err;
  });

  // Timeout after 5 minutes
  setTimeout(() => {
    console.error("\nAuth flow timed out after 5 minutes.");
    shutdown(1);
  }, 5 * 60 * 1000);
}

main();
