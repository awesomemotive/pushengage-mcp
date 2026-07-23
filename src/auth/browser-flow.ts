// src/auth/browser-flow.ts
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';

import { AuthDeniedError, AuthStateMismatchError } from '../http/errors';

export type BrowserFlowOptions = {
  dashboardUrl: string;
  clientName: string;
  mcpVersion: string;
  timeoutMs?: number;
  /** Injection point for tests; defaults to the `open` library. */
  open?: (url: string) => Promise<unknown>;
};

export type BrowserFlowResult = {
  token: string;
  expires_at?: string;
};

type CallbackDecision =
  | { kind: 'ok'; token: string; expiresAt?: string }
  | { kind: 'state_mismatch' }
  | { kind: 'denied' }
  | { kind: 'missing_token' };

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let inFlight = false;
// Teardown for the currently-active flow, so a new pushengage_auth_login can supersede a stale one
// (e.g. a previous attempt the user abandoned in the browser) instead of being blocked.
let abortActive: (() => void) | undefined;

// `open` is an ESM-only package; we dynamic-import it so this CommonJS module
// can still load without `ERR_REQUIRE_ESM`. Tests inject their own opener and
// never hit this path.
async function defaultOpen(url: string): Promise<unknown> {
  const mod = (await import('open')) as { default: (target: string) => Promise<unknown> };
  return mod.default(url);
}

export async function runBrowserFlow(opts: BrowserFlowOptions): Promise<BrowserFlowResult> {
  // A new login supersedes any stale in-flight one: tear the old flow down (rejecting it) so the
  // user never has to wait out the timeout after abandoning a previous attempt.
  if (inFlight && abortActive) {
    abortActive();
  }

  // Compute everything that could throw synchronously BEFORE we set inFlight=true,
  // so that a future addition between the flag and the Promise body can't strand
  // the flag in the `true` state and permanently brick pushengage_auth_login.
  const state = crypto.randomBytes(32).toString('hex');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const opener = opts.open ?? defaultOpen;

  // CORS for the dashboard's cross-origin POST to the loopback. The token travels in the POST
  // body (not the URL). It's not a credentialed request (no cookies), so scoping to the dashboard
  // origin is sufficient; fall back to '*' if the URL can't be parsed.
  const allowOrigin = (() => {
    try {
      return new URL(opts.dashboardUrl).origin;
    } catch {
      return '*';
    }
  })();
  const corsHeaders: Record<string, string> = {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    // Chrome's Private Network Access sends a preflight for public-origin -> loopback requests and
    // requires this on the response, or it blocks the POST. Harmless on browsers that ignore it.
    'access-control-allow-private-network': 'true',
    vary: 'Origin',
  };

  inFlight = true;

  return new Promise<BrowserFlowResult>((resolve, reject) => {
    // Validate the callback fields. Pure — the caller writes the response and calls finish().
    const classify = (fields: {
      error?: string | null;
      receivedState?: string | null;
      token?: string | null;
      expiresAt?: string;
    }): CallbackDecision => {
      if (fields.receivedState !== state) return { kind: 'state_mismatch' };
      if (fields.error === 'user_denied') return { kind: 'denied' };
      if (!fields.token) return { kind: 'missing_token' };
      return { kind: 'ok', token: fields.token, expiresAt: fields.expiresAt };
    };

    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/cb') {
          res.writeHead(404).end('Not found');
          return;
        }

        // CORS preflight for the dashboard's cross-origin POST.
        if (req.method === 'OPTIONS') {
          res.writeHead(204, corsHeaders).end();
          return;
        }

        // Preferred path: the dashboard POSTs { token, state, expires_at } as JSON, so the token
        // never appears in a URL (keeping it out of browser history / access logs). We answer with
        // CORS headers so the cross-origin fetch succeeds; the dashboard renders its own result UI.
        if (req.method === 'POST') {
          const jsonHeaders = { ...corsHeaders, 'content-type': 'application/json' };
          const chunks: string[] = [];
          let size = 0;
          let handled = false;
          req.on('data', (chunk) => {
            if (handled) return;
            size += chunk.length;
            if (size > 64 * 1024) {
              handled = true;
              res
                .writeHead(413, jsonHeaders)
                .end(JSON.stringify({ ok: false, error: 'body_too_large' }));
              finish(new Error('Auth callback body too large'));
              req.destroy();
              return;
            }
            chunks.push(chunk.toString());
          });
          req.on('end', () => {
            if (handled) return;
            handled = true;
            let body: Record<string, string>;
            try {
              body = JSON.parse(chunks.join('') || '{}') as Record<string, string>;
            } catch {
              res
                .writeHead(400, jsonHeaders)
                .end(JSON.stringify({ ok: false, error: 'invalid_json' }));
              finish(new Error('Invalid callback body'));
              return;
            }
            const decision = classify({
              error: body.error,
              receivedState: body.state,
              token: body.token,
              expiresAt: body.expires_at,
            });
            switch (decision.kind) {
              case 'state_mismatch':
                res
                  .writeHead(400, jsonHeaders)
                  .end(JSON.stringify({ ok: false, error: 'state_mismatch' }));
                finish(new AuthStateMismatchError());
                return;
              case 'denied':
                res
                  .writeHead(200, jsonHeaders)
                  .end(JSON.stringify({ ok: false, error: 'user_denied' }));
                finish(new AuthDeniedError());
                return;
              case 'missing_token':
                res
                  .writeHead(400, jsonHeaders)
                  .end(JSON.stringify({ ok: false, error: 'missing_token' }));
                finish(new Error('Auth callback missing token'));
                return;
              default:
                res.writeHead(200, jsonHeaders).end(JSON.stringify({ ok: true }));
                finish(undefined, { token: decision.token, expires_at: decision.expiresAt });
                return;
            }
          });
          req.on('error', () => {
            if (handled) return;
            handled = true;
            finish(new Error('Auth callback request error'));
          });
          return;
        }

        // The dashboard now always POSTs the token as JSON (see above) — a GET with the token in
        // the query string would leak it into browser history and any request logs, so it's
        // rejected outright rather than accepted as a fallback.
        res
          .writeHead(405, { 'content-type': 'text/plain', allow: 'POST, OPTIONS' })
          .end('Method not allowed');
        return;
      } catch (e) {
        res.writeHead(500).end('Internal error');
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    });

    let timer: NodeJS.Timeout | undefined;
    let done = false;

    function finish(err?: Error, result?: BrowserFlowResult) {
      if (done) return;
      done = true;
      inFlight = false;
      abortActive = undefined;
      if (timer) clearTimeout(timer);
      // Allow the response to flush before closing.
      setTimeout(() => server.close(), 50);
      if (err) reject(err);
      else resolve(result!);
    }

    // Expose teardown so a later pushengage_auth_login can supersede this flow.
    abortActive = () =>
      finish(new Error('pushengage_auth_login was superseded by a newer login attempt.'));

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      const callback = `http://127.0.0.1:${port}/cb`;
      const authorize = new URL('/authorize-mcp', opts.dashboardUrl);
      authorize.searchParams.set('callback', callback);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('client_name', opts.clientName);
      authorize.searchParams.set('mcp_version', opts.mcpVersion);

      timer = setTimeout(
        () => finish(new Error('Auth flow timed out waiting for browser')),
        timeoutMs,
      );

      opener(authorize.toString()).catch((openErr) => {
        // Surface the URL to stderr so the user can copy/paste it.
        console.error(
          `[pushengage-mcp] Could not launch browser automatically. Open this URL manually:\n  ${authorize.toString()}\n`,
        );
        if (process.env.PE_MCP_DEBUG) console.error(openErr);
      });
    });

    server.on('error', (err) => finish(err));
  });
}
