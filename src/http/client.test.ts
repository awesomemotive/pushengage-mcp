// src/http/client.test.ts
import { ApiClient, __testing__ } from './client';
import { AuthExpiredError, ValidationError, ApiError } from './errors';

describe('ApiClient', () => {
  const baseConfig = {
    api_url: 'https://app.pushengage.com',
    token: 'JWT_VALUE',
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('sends Authorization header with bearer token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new ApiClient(baseConfig);
    await client.get('/sites');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const args = fetchMock.mock.calls[0];
    const init = args[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer JWT_VALUE');
  });

  it('sends the X-PE-Client identification headers on every request', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new ApiClient(baseConfig);
    await client.get('/sites');
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-PE-Client']).toBe('mcp');
    expect(typeof headers['X-PE-Client-Version']).toBe('string');
    expect(headers['X-PE-Client-Version'].length).toBeGreaterThan(0);
  });

  it('throws AuthExpiredError on 401', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ message: 'Expired' }), { status: 401 }));
    const client = new ApiClient(baseConfig);
    await expect(client.get('/sites')).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('throws ValidationError on 422', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Bad', errors: { url: 'Invalid' } }), {
        status: 422,
      }),
    );
    const client = new ApiClient(baseConfig);
    await expect(client.post('/sites/1/notifications', {})).rejects.toBeInstanceOf(ValidationError);
  });

  it('retries once on 503 then succeeds', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const client = new ApiClient(baseConfig);
    const result = await client.get<{ ok: boolean }>('/sites');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it('throws ApiError on persistent 5xx after retry', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }));
    const client = new ApiClient(baseConfig);
    await expect(client.get('/sites')).rejects.toBeInstanceOf(ApiError);
    // Verify the retry actually happened — regression guard against accidentally
    // disabling the retry while keeping this test green on a single 5xx response.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a timeout ApiError when the request exceeds timeoutMs', async () => {
    // Faithful to the real wiring: fetch honors the abort signal the client attaches. The signal
    // comes from AbortSignal.timeout, so its `reason` is a DOMException named 'TimeoutError'.
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const signal = (init as RequestInit).signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason));
      });
    });
    const client = new ApiClient({ ...baseConfig, timeoutMs: 50 });
    const err = await client.get('/sites').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toMatch(/timed out/i);
  });

  it('throws when called without a token', async () => {
    const client = new ApiClient({ api_url: 'https://app.pushengage.com' });
    await expect(client.get('/sites')).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('retryDelayMs stays within the jittered [500, 750) range', () => {
    for (const r of [0, 0.5, 0.999]) {
      jest.spyOn(Math, 'random').mockReturnValue(r);
      const delay = __testing__.retryDelayMs();
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThan(750);
    }
  });
});
