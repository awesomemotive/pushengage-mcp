// src/siteSettings/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { errorResult } from '../http/errors';
import { resolveContext } from '../context';
import { CampaignDefaultsOutput, ServiceWorkerSettingsOutput } from '../output';
import {
  getCampaignDefaults,
  getServiceWorkerSettings,
  updateCampaignDefaults,
  updateServiceWorkerSettings,
} from './api';
import {
  GetCampaignDefaultsInputSchema,
  GetServiceWorkerSettingsInputSchema,
  UpdateCampaignDefaultsInputSchema,
  UpdateServiceWorkerSettingsInputSchema,
  buildServiceWorkerUpdateBody,
  buildUpdateBody,
} from './schema';

export function registerSiteSettingsTools(server: McpServer): void {
  server.registerTool(
    'pushengage_get_campaign_defaults',
    {
      title: 'Get campaign defaults',
      description:
        "Returns the current site's campaign default settings: utm_parameters (enabled + " +
        'source/medium/campaign/term/content), fallback_notification (title/message/url), ' +
        'fallback_attributes (city/country), and default_expiry (broken into total_seconds + ' +
        'days/hours/minutes). These are the defaults applied to push campaigns, matching the ' +
        "dashboard's Campaign Defaults page.",
      inputSchema: GetCampaignDefaultsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: CampaignDefaultsOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await getCampaignDefaults(client, siteId);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'pushengage_update_campaign_defaults',
    {
      title: 'Update campaign defaults',
      description:
        "Updates one or more of the current site's campaign default settings. Pass only the groups " +
        'and fields you want to change: utm_parameters, fallback_notification, fallback_attributes, ' +
        'and/or default_expiry. The tool reads the current values and merges your changes, so partial ' +
        'edits are fine (e.g. change just utm_parameters.source, or set default_expiry to {days:7}). ' +
        'default_expiry is given as days/hours/minutes (omitted components count as 0; total must be ' +
        'between 1 minute and 28 days). When utm_parameters.enabled is true, source/medium/campaign ' +
        'must be non-empty after the merge. Provide at least one group. Returns the updated settings.',
      inputSchema: UpdateCampaignDefaultsInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      outputSchema: CampaignDefaultsOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const current = await getCampaignDefaults(client, siteId);
        const { body, result } = buildUpdateBody(input, current);
        await updateCampaignDefaults(client, siteId, body);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'pushengage_get_service_worker_settings',
    {
      title: 'Get service worker settings',
      description:
        "Returns the current site's Service Worker Settings (from the Advanced Settings page), using " +
        'the dashboard labels: enable_service_worker_registration ("Enable the service worker ' +
        'registration from PushEngage"), enable_service_worker_in_subfolder ("Enable addition of ' +
        'service worker in another sub-folder"), and service_worker_file_path ("Path for service worker file").',
      inputSchema: GetServiceWorkerSettingsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: ServiceWorkerSettingsOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await getServiceWorkerSettings(client, siteId);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'pushengage_update_service_worker_settings',
    {
      title: 'Update service worker settings',
      description:
        "Updates the current site's Service Worker Settings. Pass only the fields you want to change: " +
        'enable_service_worker_registration, enable_service_worker_in_subfolder, and/or ' +
        'service_worker_file_path. The tool reads the current values and merges your changes. When ' +
        'enable_service_worker_registration is true, service_worker_file_path must be non-empty after ' +
        'the merge. Provide at least one field. Returns the updated settings.',
      inputSchema: UpdateServiceWorkerSettingsInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      outputSchema: ServiceWorkerSettingsOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const current = await getServiceWorkerSettings(client, siteId);
        const { body, result } = buildServiceWorkerUpdateBody(input, current);
        await updateServiceWorkerSettings(client, siteId, body);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
