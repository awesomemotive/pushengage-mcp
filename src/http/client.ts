// src/http/client.ts
import { PE_CLIENT } from '../constants';
import { PKG_VERSION } from '../version';
import { ApiError, AuthExpiredError, mapHttpError } from './errors';

type ApiResponseEnvelope<T> = { data: T } | T;

export type ApiClientConfig = {
  api_url: string;
  token?: string;
  /**
   * Per-attempt request timeout in milliseconds (defaults to 30s). Each attempt (including the
   * retry) gets its own fresh budget, so a hung server can never block a tool call forever.
   */
  timeoutMs?: number;
};

const RETRYABLE_STATUSES = new Set([502, 503, 504]);

const DEFAULT_TIMEOUT_MS = 30_000;

const RETRY_BASE_DELAY_MS = 500;
const RETRY_JITTER_MS = 250;

/**
 * Backoff before the single retry. A fixed delay makes many clients that hit the same 5xx retry
 * in lockstep, hammering a recovering server at the same instant (thundering herd). Adding random
 * jitter spreads the retries out. Range: [500, 750) ms.
 */
function retryDelayMs(): number {
  return RETRY_BASE_DELAY_MS + Math.floor(Math.random() * RETRY_JITTER_MS);
}

// Exported only for unit tests.
export const __testing__ = { retryDelayMs };

// The MCP only talks to the dashboard customer API, which is always under `/d/v1/...`
// (see https://app.pushengage.com/d/v1/...). If a later chunk needs a non-dashboard
// endpoint (e.g. /api/v2 REST endpoints, /admin/v1 admin endpoints) we'll either rename
// this helper or make the prefix a constructor option. For now the hardcode is
// intentional: every tool in this MCP hits a /d/v1/* path.
function joinDashboardApiUrl(base: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}/d/v1${p}`;
}

function unwrap<T>(body: ApiResponseEnvelope<T>): T {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data: T }).data;
  }
  return body as T;
}

async function readJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return { message: text } as unknown as T;
    }
  }
  return (await res.json()) as T;
}

export class ApiClient {
  constructor(private readonly config: ApiClientConfig) {}

  /**
   * Stable per-credential identity for client-side caches (e.g. `listSites`). Combines the API
   * base URL and token so a different user or environment naturally misses another's cache. Used
   * only as an in-memory Map/slot key; never logged or persisted.
   */
  get cacheKey(): string {
    // `|` separator: it can appear in neither a URL nor a base64url JWT, so distinct
    // (api_url, token) pairs can never collide into the same key.
    return `${this.config.api_url}|${this.config.token ?? ''}`;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.config.token) {
      throw new AuthExpiredError('Not authenticated');
    }
    const url = joinDashboardApiUrl(this.config.api_url, path);
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: 'application/json',
        // Identify MCP-originated calls to the API (read into `auth.client` and request logs).
        'X-PE-Client': PE_CLIENT,
        'X-PE-Client-Version': PKG_VERSION,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // A fresh timeout signal per attempt. A single shared signal would let the first attempt spend
    // the whole budget and leave the retry no time. `AbortSignal.timeout` aborts the fetch with a
    // TimeoutError once the deadline passes, covering the "connection succeeds but the response
    // never comes" case that plain fetch would otherwise wait on indefinitely.
    const attempt = () => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

    let res: Response;
    try {
      res = await attempt();
      if (RETRYABLE_STATUSES.has(res.status)) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs()));
        res = await attempt();
      }
    } catch (err) {
      // A timed-out request aborts with a DOMException named 'TimeoutError' (older runtimes may
      // surface 'AbortError'). Note: a DOMException is NOT an `instanceof Error` in Node, so match
      // on the `name` field directly rather than narrowing to Error first. Report it distinctly so
      // the user sees a real timeout rather than a vague "fetch failed" reason.
      const errName = (err as { name?: unknown } | null)?.name;
      if (errName === 'TimeoutError' || errName === 'AbortError') {
        throw new ApiError(
          0,
          `Request to the PushEngage API at ${this.config.api_url} timed out after ` +
            `${Math.round(timeoutMs / 1000)}s. The service may be slow or unreachable; ` +
            'try again shortly.',
        );
      }
      // Network-level failure (connection refused, DNS, TLS, "fetch failed"); there is no HTTP
      // response to map. Surface a clear, actionable message instead of a bare "fetch failed".
      const reason = err instanceof Error ? err.message : String(err);
      throw new ApiError(
        0,
        `Could not reach the PushEngage API at ${this.config.api_url} (${reason}). ` +
          'Check the URL is correct and the service is running/reachable.',
      );
    }

    if (!res.ok) {
      const errBody = await readJson<unknown>(res).catch(() => ({}));
      throw mapHttpError(res.status, errBody);
    }

    if (res.status === 204) return undefined as unknown as T;
    const json = await readJson<ApiResponseEnvelope<T>>(res);
    return unwrap(json);
  }
}
