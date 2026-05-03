// src/commands/login.ts
// `engram login`
//
// Opens the ENGRAM web app's /auth/cli page in the browser.
// Waits for the OAuth callback on a local HTTP server (port 3741).
// Stores tokens in ~/.engram/config.json for all future requests.
//
// The web app needs a /auth/cli/page.tsx that redirects to:
//   http://localhost:3741/callback?access_token=...&user_id=...&email=...

import * as http from 'http';
import * as url from 'url';
import open from 'open';
import { saveConfig, loadConfig } from '../storage/config';
import { syncAll } from '../core/sync';
import {
  printBanner, printSyncStatus, brand, subtle, success, printError,
} from '../ui/print';
import chalk from 'chalk';

const CALLBACK_PORT = 3741;
const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}/callback`;

export async function loginCommand(): Promise<void> {
  printBanner();

  const config = loadConfig();

  if (!config.engramApiUrl) {
    printError(
      'ENGRAM web app URL not configured.\n' +
      '  Set it with: engram config --api-url https://your-app.vercel.app'
    );
    process.exit(1);
  }

  const authUrl = `${config.engramApiUrl}/auth/cli?redirect=${encodeURIComponent(CALLBACK_URL)}`;

  console.log(brand('  Opening ENGRAM login in your browser...\n'));
  console.log(subtle(`  If it doesn't open: ${authUrl}\n`));

  await open(authUrl);

  let tokens: { accessToken: string; userId: string; email: string };
  try {
    tokens = await waitForCallback();
  } catch (e: unknown) {
    printError(e instanceof Error ? e.message : 'Login failed');
    process.exit(1);
  }

  saveConfig({
    accessToken: tokens.accessToken,
    userId: tokens.userId,
    userEmail: tokens.email,
  });

  console.log(success('\n  ✓ Logged in as ') + chalk.white(tokens.email) + '\n');

  // Pull existing captures from the web app
  const sync = await syncAll();
  if (sync.pulled > 0) {
    console.log(success(`  ↓ ${sync.pulled} capture${sync.pulled > 1 ? 's' : ''} synced from web app\n`));
  }
}

function waitForCallback(): Promise<{ accessToken: string; userId: string; email: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url || '', true);

      if (parsed.pathname === '/callback') {
        const { access_token, user_id, email } = parsed.query;

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body style="background:#0d1117;color:#e6edf3;font-family:monospace;padding:40px;text-align:center">
            <h2 style="color:#7c3aed">✓ ENGRAM authenticated</h2>
            <p>You can close this tab and return to your terminal.</p>
          </body></html>
        `);

        server.close();

        if (!access_token || !user_id) {
          reject(new Error('Missing tokens in callback. Try again.'));
          return;
        }

        resolve({
          accessToken: access_token as string,
          userId: user_id as string,
          email: (email as string) || '',
        });
      }
    });

    server.listen(CALLBACK_PORT, () => {
      // Server ready — waiting for browser redirect
    });

    server.on('error', (e) => {
      reject(new Error(`Could not start callback server on port ${CALLBACK_PORT}: ${e.message}`));
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Login timed out. Please try again.'));
    }, 5 * 60 * 1000);
  });
}
