// src/siteSettings/schema.ts
//
// Tools for the "site settings" category. These wrap a few site-setting pages, all backed by the
// generic /sites/:siteId/settings endpoint:
//   Campaign Defaults (settings/campaign-defaults):
//     - utm_settings               -> UTM Parameters
//     - default_notification       -> Fallback Notification
//     - default_custom_params      -> Fallback Attributes
//     - default_notification_expiry-> Default Expiry for notifications
//   Advanced Settings (settings/advanced-settings):
//     - service_worker             -> Service Worker Settings
// The MCP field names mirror the dashboard labels (source/medium/..., title/message/url,
// city/country, days/hours/minutes, enable_service_worker_registration/...) and translate to the
// API field names at the mapper boundary.
import { z } from 'zod';

import { ValidationError } from '../http/errors';

// Limits mirror the API validators (storage/Limit/Text.js).
const MAX_UTM = 80; // source / medium / campaign / term
const MAX_UTM_CONTENT = 120;
const MAX_TITLE = 85;
const MAX_MESSAGE = 135;
const MAX_URL = 1600;
const MAX_CITY_COUNTRY = 120;
const MIN_EXPIRY_SECONDS = 60; // 1 minute
const MAX_EXPIRY_SECONDS = 2419200; // 28 days

const siteIdField = z
  .number()
  .int()
  .positive()
  .optional()
  .describe('Override the currently selected site.');

// ---- pushengage_get_campaign_defaults -------------------------------------------------

export const GetCampaignDefaultsInputSchema = z.object({
  site_id: siteIdField,
});

export type GetCampaignDefaultsInput = z.infer<typeof GetCampaignDefaultsInputSchema>;

// ---- pushengage_update_campaign_defaults ----------------------------------------------
//
// Every group and field is optional: the tool reads the current values, merges the fields the user
// provided, and writes back the complete group (the API validates each group as a whole). All
// schemas here stay plain ZodObjects so the MCP SDK emits proper input properties; cross-field
// checks (expiry range, required-when-enabled) run in buildUpdateBody, not in a .refine().

const UtmParametersInput = z.object({
  enabled: z
    .boolean()
    .optional()
    .describe('Whether UTM parameters are appended to campaign URLs. Default stays as-is.'),
  source: z.string().trim().max(MAX_UTM).optional().describe('utm_source. Required when enabled.'),
  medium: z.string().trim().max(MAX_UTM).optional().describe('utm_medium. Required when enabled.'),
  campaign: z
    .string()
    .trim()
    .max(MAX_UTM)
    .optional()
    .describe('utm_campaign. Required when enabled.'),
  term: z.string().trim().max(MAX_UTM).optional().describe('utm_term. Optional.'),
  content: z.string().trim().max(MAX_UTM_CONTENT).optional().describe('utm_content. Optional.'),
});

const FallbackNotificationInput = z.object({
  title: z.string().trim().max(MAX_TITLE).optional().describe('Fallback notification title.'),
  message: z.string().trim().max(MAX_MESSAGE).optional().describe('Fallback notification message.'),
  url: z
    .string()
    .trim()
    .max(MAX_URL)
    .optional()
    .describe('Fallback notification landing URL (https://...).'),
});

const FallbackAttributesInput = z.object({
  city: z.string().trim().max(MAX_CITY_COUNTRY).optional().describe('Fallback city. May be empty.'),
  country: z
    .string()
    .trim()
    .max(MAX_CITY_COUNTRY)
    .optional()
    .describe('Fallback country. May be empty.'),
});

const DefaultExpiryInput = z.object({
  days: z.number().int().min(0).max(28).optional().describe('Days component (0-28).'),
  hours: z.number().int().min(0).max(23).optional().describe('Hours component (0-23).'),
  minutes: z.number().int().min(0).max(59).optional().describe('Minutes component (0-59).'),
});

export const UpdateCampaignDefaultsInputSchema = z.object({
  site_id: siteIdField,
  utm_parameters: UtmParametersInput.optional().describe(
    'UTM defaults appended to campaign URLs. Provide only the fields you want to change.',
  ),
  fallback_notification: FallbackNotificationInput.optional().describe(
    'Notification shown if the browser cannot fetch the sent notification. ' +
      'Title, message, and URL are all required by the API, so any you omit are kept from the current values.',
  ),
  fallback_attributes: FallbackAttributesInput.optional().describe(
    "Fallback subscriber city/country used when the browser can't resolve them.",
  ),
  default_expiry: DefaultExpiryInput.optional().describe(
    'Default notification expiry. Set as days/hours/minutes; omitted components count as 0. ' +
      'Total must be between 1 minute and 28 days.',
  ),
});

export type UpdateCampaignDefaultsInput = z.infer<typeof UpdateCampaignDefaultsInputSchema>;

// ---- normalized view -------------------------------------------------------

export type CampaignDefaults = {
  utm_parameters: {
    enabled: boolean;
    source: string;
    medium: string;
    campaign: string;
    term: string;
    content: string;
  };
  fallback_notification: { title: string; message: string; url: string };
  fallback_attributes: { city: string; country: string };
  default_expiry: { total_seconds: number; days: number; hours: number; minutes: number };
};

function toStr(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function toNum(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function secondsToBreakdown(seconds: number): {
  total_seconds: number;
  days: number;
  hours: number;
  minutes: number;
} {
  const s = Math.max(0, Math.floor(seconds));
  return {
    total_seconds: s,
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
  };
}

/** Normalize the raw `{ utm_settings, default_notification, ... }` GET body into the MCP view. */
export function toCampaignDefaults(raw: unknown): CampaignDefaults {
  const root = asObject(raw);
  const utm = asObject(root.utm_settings);
  const notif = asObject(root.default_notification);
  const attrs = asObject(root.default_custom_params);
  const expiry = asObject(root.default_notification_expiry);
  return {
    utm_parameters: {
      enabled: typeof utm.enabled === 'boolean' ? utm.enabled : true,
      source: toStr(utm.utm_source),
      medium: toStr(utm.utm_medium),
      campaign: toStr(utm.utm_campaign),
      term: toStr(utm.utm_term),
      content: toStr(utm.utm_content),
    },
    fallback_notification: {
      title: toStr(notif.default_notification_title),
      message: toStr(notif.default_notification_message),
      url: toStr(notif.default_notification_url),
    },
    fallback_attributes: {
      city: toStr(attrs.custom_city),
      country: toStr(attrs.custom_country),
    },
    default_expiry: secondsToBreakdown(toNum(expiry.value)),
  };
}

// ---- update body builder (read-merge-write) --------------------------------

export type UpdateCampaignDefaultsBody = {
  utm_settings?: {
    enabled: boolean;
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    utm_term?: string;
    utm_content?: string;
  };
  default_notification?: {
    default_notification_title: string;
    default_notification_message: string;
    default_notification_url: string;
  };
  default_custom_params?: { custom_city: string; custom_country: string };
  default_notification_expiry?: { value: number };
};

/**
 * Merge the user's provided fields over the current settings and produce (a) the API PUT body for
 * only the touched groups and (b) the resulting normalized view to echo back. Throws ValidationError
 * for cross-field problems the per-field schema can't express (required UTM fields when enabled,
 * required fallback-notification fields, expiry out of range).
 */
export function buildUpdateBody(
  input: UpdateCampaignDefaultsInput,
  current: CampaignDefaults,
): { body: UpdateCampaignDefaultsBody; result: CampaignDefaults } {
  const body: UpdateCampaignDefaultsBody = {};
  const result: CampaignDefaults = {
    utm_parameters: { ...current.utm_parameters },
    fallback_notification: { ...current.fallback_notification },
    fallback_attributes: { ...current.fallback_attributes },
    default_expiry: { ...current.default_expiry },
  };
  const fieldErrors: Record<string, string> = {};

  if (input.utm_parameters) {
    const u = input.utm_parameters;
    const merged = {
      enabled: u.enabled ?? current.utm_parameters.enabled,
      source: u.source ?? current.utm_parameters.source,
      medium: u.medium ?? current.utm_parameters.medium,
      campaign: u.campaign ?? current.utm_parameters.campaign,
      term: u.term ?? current.utm_parameters.term,
      content: u.content ?? current.utm_parameters.content,
    };
    if (merged.enabled) {
      if (!merged.source) fieldErrors['utm_parameters.source'] = 'required when enabled';
      if (!merged.medium) fieldErrors['utm_parameters.medium'] = 'required when enabled';
      if (!merged.campaign) fieldErrors['utm_parameters.campaign'] = 'required when enabled';
    }
    result.utm_parameters = merged;
    body.utm_settings = {
      enabled: merged.enabled,
      utm_source: merged.source,
      utm_medium: merged.medium,
      utm_campaign: merged.campaign,
      ...(merged.term ? { utm_term: merged.term } : {}),
      ...(merged.content ? { utm_content: merged.content } : {}),
    };
  }

  if (input.fallback_notification) {
    const n = input.fallback_notification;
    const merged = {
      title: n.title ?? current.fallback_notification.title,
      message: n.message ?? current.fallback_notification.message,
      url: n.url ?? current.fallback_notification.url,
    };
    if (!merged.title) fieldErrors['fallback_notification.title'] = 'cannot be blank';
    if (!merged.message) fieldErrors['fallback_notification.message'] = 'cannot be blank';
    if (!merged.url) fieldErrors['fallback_notification.url'] = 'cannot be blank';
    result.fallback_notification = merged;
    body.default_notification = {
      default_notification_title: merged.title,
      default_notification_message: merged.message,
      default_notification_url: merged.url,
    };
  }

  if (input.fallback_attributes) {
    const a = input.fallback_attributes;
    const merged = {
      city: a.city ?? current.fallback_attributes.city,
      country: a.country ?? current.fallback_attributes.country,
    };
    result.fallback_attributes = merged;
    body.default_custom_params = {
      custom_city: merged.city,
      custom_country: merged.country,
    };
  }

  if (input.default_expiry) {
    const e = input.default_expiry;
    const seconds = (e.days ?? 0) * 86400 + (e.hours ?? 0) * 3600 + (e.minutes ?? 0) * 60;
    if (seconds < MIN_EXPIRY_SECONDS || seconds > MAX_EXPIRY_SECONDS) {
      fieldErrors.default_expiry = 'must be between 1 minute and 28 days';
    }
    result.default_expiry = secondsToBreakdown(seconds);
    body.default_notification_expiry = { value: seconds };
  }

  if (Object.keys(body).length === 0) {
    throw new ValidationError(
      'Provide at least one of utm_parameters, fallback_notification, fallback_attributes, or default_expiry to update.',
    );
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError('Invalid campaign defaults update.', fieldErrors);
  }

  return { body, result };
}

// ===========================================================================
// Service Worker Settings (Advanced Settings page)
// ===========================================================================

const MAX_WORKER_PATH = 500;

// ---- pushengage_get_service_worker_settings -------------------------------------------

export const GetServiceWorkerSettingsInputSchema = z.object({
  site_id: siteIdField,
});

export type GetServiceWorkerSettingsInput = z.infer<typeof GetServiceWorkerSettingsInputSchema>;

// ---- pushengage_update_service_worker_settings ----------------------------------------
//
// Field names and descriptions mirror the dashboard's Service Worker Settings labels rather than
// the API keys (workerStatus / scope / worker). Every field is optional: the tool reads the current
// values, merges the fields you provided, and writes back the complete group (the API validates the
// group as a whole). Stays a plain ZodObject; the "at least one field" and "path required when
// registration enabled" checks live in the body builder.

export const UpdateServiceWorkerSettingsInputSchema = z.object({
  site_id: siteIdField,
  enable_service_worker_registration: z
    .boolean()
    .optional()
    .describe(
      'Enable the service worker registration from PushEngage. Disable it only if your site ' +
        'already registers its own service worker. When true, service_worker_file_path is required.',
    ),
  enable_service_worker_in_subfolder: z
    .boolean()
    .optional()
    .describe('Enable addition of service worker in another sub-folder.'),
  service_worker_file_path: z
    .string()
    .trim()
    .max(MAX_WORKER_PATH)
    .optional()
    .describe(
      'Path for service worker file. Required when the service worker registration is enabled.',
    ),
});

export type UpdateServiceWorkerSettingsInput = z.infer<
  typeof UpdateServiceWorkerSettingsInputSchema
>;

// ---- normalized view -------------------------------------------------------

// Keys mirror the dashboard's Service Worker Settings labels:
//   enable_service_worker_registration  <- "Enable the service worker registration from PushEngage" (workerStatus)
//   enable_service_worker_in_subfolder  <- "Enable addition of service worker in another sub-folder"
//   service_worker_file_path            <- "Path for service worker file" (worker)
// Note enable_service_worker_in_subfolder is the inverse of the API's `scope`, matching the
// dashboard toggle (checked === !scope).
export type ServiceWorkerSettings = {
  enable_service_worker_registration: boolean;
  enable_service_worker_in_subfolder: boolean;
  service_worker_file_path: string;
};

export function toServiceWorkerSettings(raw: unknown): ServiceWorkerSettings {
  const sw = asObject(asObject(raw).service_worker);
  return {
    enable_service_worker_registration:
      typeof sw.workerStatus === 'boolean' ? sw.workerStatus : true,
    enable_service_worker_in_subfolder: typeof sw.scope === 'boolean' ? !sw.scope : false,
    service_worker_file_path: toStr(sw.worker),
  };
}

// ---- update body builder (read-merge-write) --------------------------------

export type ServiceWorkerSettingsBody = {
  service_worker: { workerStatus: boolean; scope: boolean; worker: string };
};

export function buildServiceWorkerUpdateBody(
  input: UpdateServiceWorkerSettingsInput,
  current: ServiceWorkerSettings,
): { body: ServiceWorkerSettingsBody; result: ServiceWorkerSettings } {
  if (
    input.enable_service_worker_registration === undefined &&
    input.enable_service_worker_in_subfolder === undefined &&
    input.service_worker_file_path === undefined
  ) {
    throw new ValidationError(
      'Provide at least one of enable_service_worker_registration, ' +
        'enable_service_worker_in_subfolder, or service_worker_file_path to update.',
    );
  }

  const result: ServiceWorkerSettings = {
    enable_service_worker_registration:
      input.enable_service_worker_registration ?? current.enable_service_worker_registration,
    enable_service_worker_in_subfolder:
      input.enable_service_worker_in_subfolder ?? current.enable_service_worker_in_subfolder,
    service_worker_file_path: input.service_worker_file_path ?? current.service_worker_file_path,
  };

  if (result.enable_service_worker_registration && !result.service_worker_file_path) {
    throw new ValidationError('Invalid service worker settings update.', {
      service_worker_file_path: 'required when the service worker registration is enabled',
    });
  }

  // The API's `scope` is the inverse of the dashboard's "in sub-folder" toggle.
  const body: ServiceWorkerSettingsBody = {
    service_worker: {
      workerStatus: result.enable_service_worker_registration,
      scope: !result.enable_service_worker_in_subfolder,
      worker: result.service_worker_file_path,
    },
  };

  return { body, result };
}
