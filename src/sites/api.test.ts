// src/sites/api.test.ts
import type { ApiClient } from '../http/client';
import { __testing__, getSiteDetails, listSites, updateSiteDetails } from './api';

const { adaptSitesEnvelope, toLeanSite, lastPageFromBody, clearSitesCache } = __testing__;

describe('toLeanSite', () => {
  it('picks lean fields from a full dashboard site row', () => {
    const lean = toLeanSite({
      site_id: 1,
      site_name: 'Alpha',
      site_url: 'https://a.example.com',
      site_status: 'active',
      permissions: { notifications: {} },
      site_key: 'secret-key',
    });
    expect(lean).toEqual({
      site_id: 1,
      site_name: 'Alpha',
      site_url: 'https://a.example.com',
      site_status: 'active',
    });
  });

  it('returns null when required fields are missing', () => {
    expect(toLeanSite({ site_name: 'Alpha', site_url: 'https://a.example.com' })).toBeNull();
  });
});

describe('adaptSitesEnvelope', () => {
  it('returns lean sites from a bare Site[]', () => {
    const sites = [
      { site_id: 1, site_name: 'Alpha', site_url: 'https://a.example.com', extra: true },
      { site_id: 2, site_name: 'Beta', site_url: 'https://b.example.com' },
    ];
    const out = adaptSitesEnvelope(sites);
    expect(out).toEqual([
      { site_id: 1, site_name: 'Alpha', site_url: 'https://a.example.com' },
      { site_id: 2, site_name: 'Beta', site_url: 'https://b.example.com' },
    ]);
  });

  it('unwraps the paginated { data: Site[] } envelope used by /users/:userId/sites', () => {
    const sites = [{ site_id: 7, site_name: 'Gamma', site_url: 'https://g.example.com' }];
    const out = adaptSitesEnvelope({
      data: sites,
      total: 1,
      perPage: 100,
      page: 1,
      lastPage: 1,
    });
    expect(out).toEqual(sites);
  });

  it('returns [] for an unexpected or empty shape rather than throwing', () => {
    expect(adaptSitesEnvelope(undefined)).toEqual([]);
    expect(adaptSitesEnvelope(null)).toEqual([]);
    expect(adaptSitesEnvelope({})).toEqual([]);
    expect(adaptSitesEnvelope({ unrelated: true })).toEqual([]);
  });
});

describe('lastPageFromBody', () => {
  it('reads lastPage from a paginated envelope', () => {
    expect(lastPageFromBody({ data: [], lastPage: 3, page: 1 })).toBe(3);
  });

  it('defaults to 1 for non-paginated shapes', () => {
    expect(lastPageFromBody([{ site_id: 1 }])).toBe(1);
    expect(lastPageFromBody(undefined)).toBe(1);
  });
});

type Call = { method: 'GET' | 'PATCH'; path: string; body?: unknown };

function fakeClient(getBody: unknown): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    get: async (path: string) => {
      calls.push({ method: 'GET', path });
      return getBody;
    },
    patch: async (path: string, body: unknown) => {
      calls.push({ method: 'PATCH', path, body });
      return undefined;
    },
  } as unknown as ApiClient;
  return { client, calls };
}

function fakeSitesClient(cacheKey: string): {
  client: ApiClient;
  state: { getCalls: number };
} {
  const state = { getCalls: 0 };
  const client = {
    cacheKey,
    get: async (path: string) => {
      state.getCalls += 1;
      if (path === '/users/me') return { user_id: 99 };
      return {
        data: [{ site_id: 1, site_name: 'Alpha', site_url: 'https://a.example.com' }],
        lastPage: 1,
      };
    },
  } as unknown as ApiClient;
  return { client, state };
}

describe('listSites (caching)', () => {
  beforeEach(() => clearSitesCache());

  it('caches results and serves a repeat call without re-fetching', async () => {
    const { client, state } = fakeSitesClient('user-a');
    const first = await listSites(client);
    const second = await listSites(client);
    expect(second).toEqual(first);
    // First call = GET /users/me + one sites page = 2 GETs; the second call hits the cache.
    expect(state.getCalls).toBe(2);
  });

  it('re-fetches for a different credential (cache key)', async () => {
    const a = fakeSitesClient('user-a');
    const b = fakeSitesClient('user-b');
    await listSites(a.client);
    await listSites(b.client);
    expect(a.state.getCalls).toBe(2);
    expect(b.state.getCalls).toBe(2); // different key → cache miss → its own fetch
  });

  it('clearSitesCache forces a re-fetch', async () => {
    const { client, state } = fakeSitesClient('user-a');
    await listSites(client);
    clearSitesCache();
    await listSites(client);
    expect(state.getCalls).toBe(4);
  });
});

describe('getSiteDetails', () => {
  it('requests timezone + privacy settings and normalizes the site', async () => {
    const { client, calls } = fakeClient({
      site_id: 30,
      site_name: 'Acme',
      site_url: 'https://acme.example.com',
      is_whitelabel: 1,
      settings: {
        timezone: { value: 'Asia/Kolkata' },
        privacy_settings: { geoLocationEnabled: true },
      },
    });
    const result = await getSiteDetails(client, 30);
    expect(calls[0]).toEqual({
      method: 'GET',
      path: '/sites/30?setting_name=timezone,privacy_settings',
    });
    expect(result).toMatchObject({
      site_name: 'Acme',
      timezone: 'Asia/Kolkata',
      enable_geolocation: true,
      remove_powered_by_pushengage: true,
    });
  });
});

describe('updateSiteDetails', () => {
  it('PATCHes the site with the given body', async () => {
    const { client, calls } = fakeClient({});
    await updateSiteDetails(client, 30, { site_name: 'New Name' });
    expect(calls[0]).toEqual({
      method: 'PATCH',
      path: '/sites/30',
      body: { site_name: 'New Name' },
    });
  });
});
