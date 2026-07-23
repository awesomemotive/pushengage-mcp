// src/auth/browser-flow.test.ts
import { runBrowserFlow } from './browser-flow';
import { AuthDeniedError, AuthStateMismatchError } from '../http/errors';

describe('runBrowserFlow', () => {
  it('resolves with token when the callback is POSTed as JSON (token not in URL)', async () => {
    const opener = jest.fn(async (url: string) => {
      const u = new URL(url);
      const callback = u.searchParams.get('callback')!;
      const state = u.searchParams.get('state')!;
      // Preferred path: dashboard POSTs the token in the body, so it never appears in a URL.
      await fetch(callback, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'POST_JWT', state, expires_at: '2026-05-31T00:00:00Z' }),
      });
    });

    const result = await runBrowserFlow({
      dashboardUrl: 'https://app.pushengage.com',
      clientName: 'Test',
      mcpVersion: '0.1.0',
      timeoutMs: 5000,
      open: opener,
    });

    expect(result.token).toBe('POST_JWT');
    expect(result.expires_at).toBe('2026-05-31T00:00:00Z');
  });

  it('rejects with AuthStateMismatchError on bad state', async () => {
    const opener = jest.fn(async (url: string) => {
      const u = new URL(url);
      const callback = u.searchParams.get('callback')!;
      await fetch(callback, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'POST_JWT', state: 'WRONG_STATE' }),
      });
    });

    await expect(
      runBrowserFlow({
        dashboardUrl: 'https://app.pushengage.com',
        clientName: 'Test',
        mcpVersion: '0.1.0',
        timeoutMs: 5000,
        open: opener,
      }),
    ).rejects.toBeInstanceOf(AuthStateMismatchError);
  });

  it('rejects with AuthDeniedError when callback carries error=user_denied', async () => {
    const opener = jest.fn(async (url: string) => {
      const u = new URL(url);
      const callback = u.searchParams.get('callback')!;
      const state = u.searchParams.get('state')!;
      await fetch(callback, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'user_denied', state }),
      });
    });

    await expect(
      runBrowserFlow({
        dashboardUrl: 'https://app.pushengage.com',
        clientName: 'Test',
        mcpVersion: '0.1.0',
        timeoutMs: 5000,
        open: opener,
      }),
    ).rejects.toBeInstanceOf(AuthDeniedError);
  });

  it('rejects a legacy GET callback with the token in the query string', async () => {
    const opener = jest.fn(async (url: string) => {
      const u = new URL(url);
      const callback = u.searchParams.get('callback')!;
      const state = u.searchParams.get('state')!;
      const res = await fetch(`${callback}?token=THE_JWT&state=${state}`);
      expect(res.status).toBe(405);
    });

    await expect(
      runBrowserFlow({
        dashboardUrl: 'https://app.pushengage.com',
        clientName: 'Test',
        mcpVersion: '0.1.0',
        timeoutMs: 250,
        open: opener,
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it('rejects on timeout', async () => {
    const opener = jest.fn(async () => {
      /* never call back */
    });
    await expect(
      runBrowserFlow({
        dashboardUrl: 'https://app.pushengage.com',
        clientName: 'Test',
        mcpVersion: '0.1.0',
        timeoutMs: 250,
        open: opener,
      }),
    ).rejects.toThrow(/timed out/i);
  });
});
