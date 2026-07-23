// src/siteSettings/api.test.ts
import type { ApiClient } from '../http/client';
import {
  getCampaignDefaults,
  getServiceWorkerSettings,
  updateCampaignDefaults,
  updateServiceWorkerSettings,
} from './api';

type Call = { method: 'GET' | 'PUT'; path: string; body?: unknown };

/** Fake client recording calls; `get` returns the canned body. */
function fakeClient(getBody: unknown): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    get: async (path: string) => {
      calls.push({ method: 'GET', path });
      return getBody;
    },
    put: async (path: string, body: unknown) => {
      calls.push({ method: 'PUT', path, body });
      return undefined;
    },
  } as unknown as ApiClient;
  return { client, calls };
}

describe('getCampaignDefaults', () => {
  it('requests the four settings by name and normalizes the body', async () => {
    const { client, calls } = fakeClient({
      utm_settings: { enabled: true, utm_source: 's', utm_medium: 'm', utm_campaign: 'c' },
      default_notification: {
        default_notification_title: 't',
        default_notification_message: 'msg',
        default_notification_url: 'https://x.com',
      },
      default_custom_params: { custom_city: 'NYC', custom_country: 'US' },
      default_notification_expiry: { value: 86400 },
    });
    const result = await getCampaignDefaults(client, 30);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toBe(
      '/sites/30/settings?name=utm_settings,default_notification,default_custom_params,default_notification_expiry',
    );
    expect(result.utm_parameters.source).toBe('s');
    expect(result.default_expiry).toEqual({
      total_seconds: 86400,
      days: 1,
      hours: 0,
      minutes: 0,
    });
  });
});

describe('updateCampaignDefaults', () => {
  it('PUTs the body to the settings endpoint', async () => {
    const { client, calls } = fakeClient({});
    await updateCampaignDefaults(client, 30, { default_notification_expiry: { value: 604800 } });
    expect(calls[0]).toEqual({
      method: 'PUT',
      path: '/sites/30/settings',
      body: { default_notification_expiry: { value: 604800 } },
    });
  });
});

describe('getServiceWorkerSettings', () => {
  it('requests only service_worker and normalizes (scope inverted)', async () => {
    const { client, calls } = fakeClient({
      service_worker: { workerStatus: true, scope: false, worker: 'https://x.com/sw.js' },
    });
    const result = await getServiceWorkerSettings(client, 30);
    expect(calls[0]).toEqual({ method: 'GET', path: '/sites/30/settings?name=service_worker' });
    expect(result).toEqual({
      enable_service_worker_registration: true,
      enable_service_worker_in_subfolder: true,
      service_worker_file_path: 'https://x.com/sw.js',
    });
  });
});

describe('updateServiceWorkerSettings', () => {
  it('PUTs the service_worker body', async () => {
    const { client, calls } = fakeClient({});
    await updateServiceWorkerSettings(client, 30, {
      service_worker: { workerStatus: true, scope: true, worker: 'https://x.com/sw.js' },
    });
    expect(calls[0]).toEqual({
      method: 'PUT',
      path: '/sites/30/settings',
      body: { service_worker: { workerStatus: true, scope: true, worker: 'https://x.com/sw.js' } },
    });
  });
});
