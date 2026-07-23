// src/siteSettings/api.ts
import type { ApiClient } from '../http/client';
import {
  type CampaignDefaults,
  type ServiceWorkerSettings,
  type ServiceWorkerSettingsBody,
  type UpdateCampaignDefaultsBody,
  toCampaignDefaults,
  toServiceWorkerSettings,
} from './schema';

// The four settings backing the dashboard "Campaign Defaults" page.
const CAMPAIGN_DEFAULT_SETTINGS =
  'utm_settings,default_notification,default_custom_params,default_notification_expiry';

/** Fetch the raw `{ utm_settings, default_notification, ... }` body and normalize it. */
export async function getCampaignDefaults(
  client: ApiClient,
  siteId: number,
): Promise<CampaignDefaults> {
  const body = await client.get<unknown>(
    `/sites/${siteId}/settings?name=${CAMPAIGN_DEFAULT_SETTINGS}`,
  );
  return toCampaignDefaults(body);
}

/** Upsert the provided setting groups. Only the keys present in `body` are touched. */
export async function updateCampaignDefaults(
  client: ApiClient,
  siteId: number,
  body: UpdateCampaignDefaultsBody,
): Promise<void> {
  await client.put(`/sites/${siteId}/settings`, body);
}

/** Fetch just the `service_worker` setting and normalize it. */
export async function getServiceWorkerSettings(
  client: ApiClient,
  siteId: number,
): Promise<ServiceWorkerSettings> {
  const body = await client.get<unknown>(`/sites/${siteId}/settings?name=service_worker`);
  return toServiceWorkerSettings(body);
}

/** Upsert the `service_worker` setting. */
export async function updateServiceWorkerSettings(
  client: ApiClient,
  siteId: number,
  body: ServiceWorkerSettingsBody,
): Promise<void> {
  await client.put(`/sites/${siteId}/settings`, body);
}
