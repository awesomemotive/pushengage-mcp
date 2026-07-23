// src/sites/schema.ts
//
// Schemas + mappers for the site-details tools (dashboard's Site Details page, settings/site-details).
// Backed by GET/PATCH /sites/:siteId. Field names mirror the dashboard labels rather than the API
// keys, and translate to the API field names at the mapper boundary:
//   Site Name                       -> site_name
//   Site URL                        -> site_url
//   Website Time Zone               -> settings.timezone.value           (timezone)
//   Enable Geolocation              -> settings.privacy_settings.geoLocationEnabled (enable_geolocation)
//   Remove "Powered By PushEngage"  -> is_whitelabel (0/1)               (remove_powered_by_pushengage)
import { z } from 'zod';

import { ValidationError } from '../http/errors';

// Limits mirror the API validators (storage/Limit/Text.js + storage/Models/Site.js).
const MIN_SITE_NAME = 3;
const MAX_SITE_NAME = 150;
const MAX_SITE_URL = 400;

const siteIdField = z
  .number()
  .int()
  .positive()
  .optional()
  .describe('Override the currently selected site.');

// ---- pushengage_get_site_details ------------------------------------------------------

export const GetSiteDetailsInputSchema = z.object({
  site_id: siteIdField,
});

export type GetSiteDetailsInput = z.infer<typeof GetSiteDetailsInputSchema>;

// ---- pushengage_update_site_details ---------------------------------------------------
//
// Every field is optional; only the fields you pass are sent in the PATCH. Stays a plain ZodObject
// so the SDK emits proper input properties; the "provide at least one field" check lives in the
// body builder.

export const UpdateSiteDetailsInputSchema = z.object({
  site_id: siteIdField,
  site_name: z
    .string()
    .trim()
    .min(MIN_SITE_NAME)
    .max(MAX_SITE_NAME)
    .optional()
    .describe(`Site Name. ${MIN_SITE_NAME}-${MAX_SITE_NAME} characters.`),
  site_url: z
    .string()
    .trim()
    .max(MAX_SITE_URL)
    .optional()
    .describe('Site URL. A full http(s) URL, e.g. https://example.com.'),
  timezone: z
    .string()
    .trim()
    .optional()
    .describe('Website Time Zone as an IANA name, e.g. "America/New_York" or "Asia/Kolkata".'),
  enable_geolocation: z
    .boolean()
    .optional()
    .describe(
      "Enable Geolocation. Personalizes notifications based on the subscriber's location and timezone.",
    ),
  remove_powered_by_pushengage: z
    .boolean()
    .optional()
    .describe(
      'Remove "Powered By PushEngage" branding from notifications. Requires a paid (white-label) plan; ' +
        'the API rejects it otherwise.',
    ),
});

export type UpdateSiteDetailsInput = z.infer<typeof UpdateSiteDetailsInputSchema>;

// ---- normalized view -------------------------------------------------------

export type SiteDetails = {
  site_id: number | undefined;
  site_name: string;
  site_url: string;
  site_image: string;
  timezone: string;
  enable_geolocation: boolean;
  remove_powered_by_pushengage: boolean;
};

function toStr(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function toSiteDetails(raw: unknown): SiteDetails {
  const root = asObject(raw);
  const settings = asObject(root.settings);
  const timezone = asObject(settings.timezone);
  const privacy = asObject(settings.privacy_settings);
  return {
    site_id: typeof root.site_id === 'number' ? root.site_id : undefined,
    site_name: toStr(root.site_name),
    site_url: toStr(root.site_url),
    site_image: toStr(root.site_image),
    timezone: toStr(timezone.value),
    enable_geolocation: privacy.geoLocationEnabled === true,
    remove_powered_by_pushengage: root.is_whitelabel === 1,
  };
}

// ---- update body builder ---------------------------------------------------

export type SiteDetailsUpdateBody = {
  site_name?: string;
  site_url?: string;
  is_whitelabel?: 0 | 1;
  settings?: {
    timezone?: { value: string };
    privacy_settings?: { geoLocationEnabled: boolean };
  };
};

/**
 * Build the PATCH body from only the fields the user provided (each site-detail field is
 * independently patchable) and the resulting normalized view to echo back (current overlaid with
 * the changes). Throws ValidationError when nothing was provided.
 *
 * Quirk: the API's `PATCH /sites/:siteId` validator requires at least one *top-level* site field
 * (site_name / site_url / is_whitelabel / ...) and strips the `settings` object before that check.
 * So a settings-only update (timezone and/or geolocation) would be rejected. We re-send the current
 * site_name (a no-op write) in that case to satisfy the constraint, mirroring how the dashboard
 * always includes site_name on save.
 */
export function buildSiteDetailsUpdateBody(
  input: UpdateSiteDetailsInput,
  current: SiteDetails,
): { body: SiteDetailsUpdateBody; result: SiteDetails } {
  const body: SiteDetailsUpdateBody = {};
  const result: SiteDetails = { ...current };

  if (input.site_name !== undefined) {
    body.site_name = input.site_name;
    result.site_name = input.site_name;
  }
  if (input.site_url !== undefined) {
    body.site_url = input.site_url;
    result.site_url = input.site_url;
  }
  if (input.timezone !== undefined) {
    body.settings = { ...body.settings, timezone: { value: input.timezone } };
    result.timezone = input.timezone;
  }
  if (input.enable_geolocation !== undefined) {
    body.settings = {
      ...body.settings,
      privacy_settings: { geoLocationEnabled: input.enable_geolocation },
    };
    result.enable_geolocation = input.enable_geolocation;
  }
  if (input.remove_powered_by_pushengage !== undefined) {
    body.is_whitelabel = input.remove_powered_by_pushengage ? 1 : 0;
    result.remove_powered_by_pushengage = input.remove_powered_by_pushengage;
  }

  if (Object.keys(body).length === 0) {
    throw new ValidationError(
      'Provide at least one of site_name, site_url, timezone, enable_geolocation, or ' +
        'remove_powered_by_pushengage to update.',
    );
  }

  // The API rejects a body that has only `settings` (it requires a top-level site field and strips
  // `settings` before its min-one-key check). Re-send the current site_name as a harmless no-op so
  // timezone-only / geolocation-only updates succeed.
  const hasTopLevelField =
    body.site_name !== undefined || body.site_url !== undefined || body.is_whitelabel !== undefined;
  if (body.settings && !hasTopLevelField && current.site_name) {
    body.site_name = current.site_name;
  }

  return { body, result };
}
