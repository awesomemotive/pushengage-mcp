// src/output.ts
import { z } from 'zod';

/**
 * Output schemas for tools are intentionally lenient. Each documents the notable top-level fields
 * as a hint for clients and the LLM, but is `.partial().passthrough()` so the SDK's runtime
 * structuredContent validation can never reject a real response: extra fields pass through and
 * missing ones are tolerated. This gives consumers machine-readable structured output and a shape
 * hint without turning every upstream API tweak into a broken tool. Schemas live here (rather than
 * next to the input schemas) so tool modules can add structured output without importing zod.
 */

/** A lenient array of objects: list items are documented loosely, not field-by-field. */
export const looseItems = z.array(z.object({}).passthrough());

/** Wrap a field shape into a lenient (all-optional, passthrough) output schema. */
function looseOutput(shape: z.ZodRawShape) {
  return z.object(shape).partial().passthrough();
}

/** Lenient output schema for a paginated `list_*` tool with the given items key. */
function paginatedOutput(itemsKey: string) {
  return looseOutput({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    last_page: z.number(),
    has_more: z.boolean(),
    [itemsKey]: looseItems,
  });
}

// ---- auth --------------------------------------------------------------------
export const AuthLoginOutput = looseOutput({
  authorized: z.boolean(),
  expires_at: z.string(),
});
export const AuthStatusOutput = looseOutput({
  authenticated: z.boolean(),
  api_url: z.string(),
  dashboard_url: z.string(),
  expires_at: z.string(),
  current_site_id: z.number(),
  client_name: z.string(),
});
export const AuthLogoutOutput = looseOutput({
  status: z.string(),
  server_session_revoked: z.boolean().nullable(),
});

// ---- sites -------------------------------------------------------------------
export const ListSitesOutput = looseOutput({
  sites: looseItems,
  current_site_id: z.number(),
});
export const SelectSiteOutput = looseOutput({
  current_site_id: z.number(),
  site_name: z.string(),
  site_url: z.string(),
});
/** Shared by get_site_details and update_site_details (both return the Site Details view). */
export const SiteDetailsOutput = looseOutput({
  site_id: z.number(),
  site_name: z.string(),
  site_url: z.string(),
  site_image: z.string(),
  timezone: z.string(),
  enable_geolocation: z.boolean(),
  remove_powered_by_pushengage: z.boolean(),
});

// ---- analytics ---------------------------------------------------------------
export const AnalyticsSummaryOutput = looseOutput({
  total_subscribers: z.number(),
  total_notifications_sent: z.number(),
  total_views: z.number(),
  total_clicks: z.number(),
  total_goal_count: z.number(),
  total_goal_value: z.number(),
});
export const AnalyticsTimeseriesOutput = looseOutput({
  group_by: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  count: z.number(),
  points: looseItems,
});

// ---- campaigns ---------------------------------------------------------------
export const CampaignsListOutput = paginatedOutput('campaigns');
export const WorkflowsListOutput = paginatedOutput('workflows');

// ---- chat widgets ------------------------------------------------------------
export const ChatWidgetsListOutput = paginatedOutput('chat_widgets');

// ---- segments ----------------------------------------------------------------
export const SegmentsListOutput = paginatedOutput('segments');
export const CreateSegmentOutput = looseOutput({
  segment_id: z.number(),
  segment_name: z.string(),
  segment_criteria: z.unknown(),
  add_segment_on_page_load: z.boolean(),
  view_url: z.string(),
});

// ---- audience groups ---------------------------------------------------------
export const AudienceGroupsListOutput = paginatedOutput('audience_groups');
export const CreateAudienceGroupOutput = looseOutput({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  filter: z.unknown(),
  view_url: z.string(),
  use_with_send_notification: z.object({}).passthrough(),
});

// ---- attributes --------------------------------------------------------------
export const AttributesListOutput = paginatedOutput('attributes');
export const CreateAttributeOutput = looseOutput({
  id: z.number(),
  name: z.string(),
  key: z.string(),
  status: z.unknown(),
  view_url: z.string(),
  use_with_audience_group_rule: z.object({}).passthrough(),
});

// ---- notifications -----------------------------------------------------------
export const NotificationsListOutput = paginatedOutput('notifications');
export const SendNotificationOutput = looseOutput({
  notification_id: z.unknown(),
  status: z.unknown(),
  title: z.string(),
  message: z.string(),
  url: z.string(),
  view_url: z.string(),
});
export const SendAbNotificationOutput = looseOutput({
  notification_id: z.unknown(),
  ab_notification_id: z.unknown(),
  status: z.unknown(),
  view_url: z.string(),
});

// ---- site settings -----------------------------------------------------------
/** Shared by get_campaign_defaults and update_campaign_defaults. */
export const CampaignDefaultsOutput = looseOutput({
  utm_parameters: z.object({}).passthrough(),
  fallback_notification: z.object({}).passthrough(),
  fallback_attributes: z.object({}).passthrough(),
  default_expiry: z.object({}).passthrough(),
});
/** Shared by get_service_worker_settings and update_service_worker_settings. */
export const ServiceWorkerSettingsOutput = looseOutput({
  enable_service_worker_registration: z.boolean(),
  enable_service_worker_in_subfolder: z.boolean(),
  service_worker_file_path: z.string(),
});
