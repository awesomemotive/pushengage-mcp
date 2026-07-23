// src/sites/api.ts
import type { ApiClient } from '../http/client';
import { ApiError } from '../http/errors';
import { type SiteDetails, type SiteDetailsUpdateBody, toSiteDetails } from './schema';

/**
 * Lean Site shape returned by `pushengage_list_sites`.
 *
 * Field names mirror the API's site fields:
 *   - `site_id`     (number, primary key)
 *   - `site_name`   (display name)
 *   - `site_url`    (canonical URL — use as notification URL when the user asks)
 *   - `site_status` ('active' | 'delete' | 'inactive'; API list only returns active)
 */
export type Site = {
  site_id: number;
  site_name: string;
  site_url: string;
  site_status?: string;
};

type MeResponse = {
  user_id: number;
};

type PaginatedSites = {
  data?: unknown;
  total?: number;
  perPage?: number;
  page?: number;
  lastPage?: number;
};

const SITES_PAGE_LIMIT = 100;

/**
 * `listSites` is expensive (GET /users/me + a paginated /users/:id/sites loop) yet is called back
 * to back — e.g. `pushengage_list_sites` to show the user their sites, then `pushengage_select_site` calls it again just
 * to validate the id. A short-lived, single-slot in-memory cache collapses those repeats into one
 * fetch. The slot is keyed on the client's credentials (api_url + token) so an account/env switch
 * overwrites rather than serves stale data, and expires after a minute so a site created in the
 * dashboard shows up soon. A single slot (not a Map) bounds memory to one entry and, because one
 * MCP process serves one credential at a time, needs no eviction.
 */
const SITES_CACHE_TTL_MS = 60_000;

type SitesCacheEntry = { key: string; sites: Site[]; expiresAt: number };
let sitesCache: SitesCacheEntry | undefined;

function clearSitesCache(): void {
  sitesCache = undefined;
}

export function toLeanSite(raw: Record<string, unknown>): Site | null {
  if (typeof raw.site_id !== 'number') return null;
  if (typeof raw.site_name !== 'string') return null;
  if (typeof raw.site_url !== 'string') return null;
  return {
    site_id: raw.site_id,
    site_name: raw.site_name,
    site_url: raw.site_url,
    ...(typeof raw.site_status === 'string' ? { site_status: raw.site_status } : {}),
  };
}

/**
 * Normalize whatever shape the upstream `/users/:userId/sites` endpoint hands
 * back into a bare `Site[]`. The dashboard API uses a paginated envelope
 * (`{ data: [...], total, perPage, page, lastPage }`) after the http client
 * strips the outer `{ data: ... }` wrapper, but we defensively handle a bare
 * array, a `{ sites: [...] }` wrapper, and anything else (→ `[]`).
 */
export function adaptSitesEnvelope(body: unknown): Site[] {
  let rows: unknown[] = [];
  if (Array.isArray(body)) {
    rows = body;
  } else if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.data)) rows = obj.data;
    else if (Array.isArray(obj.sites)) rows = obj.sites;
  }
  return rows
    .map((row) => toLeanSite(row as Record<string, unknown>))
    .filter((site): site is Site => site !== null);
}

function lastPageFromBody(body: unknown): number {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const lastPage = (body as PaginatedSites).lastPage;
    if (typeof lastPage === 'number' && lastPage >= 1) return lastPage;
  }
  return 1;
}

// Exported only for unit tests; consumers should call `listSites`.
export const __testing__ = { adaptSitesEnvelope, toLeanSite, lastPageFromBody, clearSitesCache };

/**
 * Fetch the authenticated user's accessible sites.
 *
 * Two API calls because the dashboard API has no `/sites` collection endpoint scoped
 * to the current user:
 *   1. GET /users/me              → resolves user_id
 *   2. GET /users/:userId/sites   → paginated, active sites only (limit max 100)
 */
export async function listSites(client: ApiClient): Promise<Site[]> {
  const key = client.cacheKey;
  const now = Date.now();
  if (sitesCache && sitesCache.key === key && sitesCache.expiresAt > now) {
    return sitesCache.sites;
  }

  const me = await client.get<MeResponse>('/users/me');
  if (!me || typeof me.user_id !== 'number') {
    throw new ApiError(502, 'Could not resolve authenticated user from GET /users/me');
  }

  const sites: Site[] = [];
  let page = 1;
  let lastPage = 1;

  do {
    const body = await client.get<PaginatedSites | Site[] | { sites: Site[] }>(
      `/users/${me.user_id}/sites?limit=${SITES_PAGE_LIMIT}&page=${page}`,
    );
    sites.push(...adaptSitesEnvelope(body));
    lastPage = lastPageFromBody(body);
    page += 1;
  } while (page <= lastPage);

  sitesCache = { key, sites, expiresAt: now + SITES_CACHE_TTL_MS };
  return sites;
}

/**
 * Fetch a single site plus the timezone + privacy settings, normalized to the Site Details view.
 * Mirrors the dashboard's `sites/:siteId?setting_name=timezone,privacy_settings` request.
 */
export async function getSiteDetails(client: ApiClient, siteId: number): Promise<SiteDetails> {
  const body = await client.get<unknown>(`/sites/${siteId}?setting_name=timezone,privacy_settings`);
  return toSiteDetails(body);
}

/** PATCH the site with only the provided fields. */
export async function updateSiteDetails(
  client: ApiClient,
  siteId: number,
  body: SiteDetailsUpdateBody,
): Promise<void> {
  await client.patch(`/sites/${siteId}`, body);
}
