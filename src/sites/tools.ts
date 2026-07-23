// src/sites/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ApiClient } from '../http/client';
import { ValidationError } from '../http/errors';
import { errorResult } from '../http/errors';
import { resolveContext } from '../context';
import { ListSitesOutput, SelectSiteOutput, SiteDetailsOutput } from '../output';
import { loadConfig, saveConfig } from '../config';
import { getSiteDetails, listSites, updateSiteDetails } from './api';
import {
  GetSiteDetailsInputSchema,
  UpdateSiteDetailsInputSchema,
  buildSiteDetailsUpdateBody,
} from './schema';

export function registerSiteTools(server: McpServer): void {
  server.registerTool(
    'pushengage_list_sites',
    {
      title: 'List sites',
      description:
        'Lists PushEngage sites the authenticated user can access. Returns site_id, site_name, ' +
        'site_url, and site_status. Also returns current_site_id so the assistant can see which ' +
        'site is already active without calling pushengage_auth_status. When the user asks to send ' +
        "a notification linking to their site's homepage, use site_url as the notification's url field.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: ListSitesOutput,
    },
    async () => {
      try {
        const config = await loadConfig();
        const client = new ApiClient({ api_url: config.api_url, token: config.token });
        const sites = await listSites(client);
        const payload = { sites, current_site_id: config.current_site_id };
        return {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'pushengage_select_site',
    {
      title: 'Select current site',
      description:
        'Sets the current site used by all site-scoped tools (pushengage_send_notification, ' +
        'pushengage_list_segments, pushengage_get_analytics_summary, pushengage_list_drip_campaigns, ' +
        'etc.) when no site_id is provided. Persists across MCP restarts. Call pushengage_list_sites ' +
        'first to get a valid site_id.',
      inputSchema: z.object({
        site_id: z
          .number()
          .int()
          .positive()
          .describe('PushEngage site_id from pushengage_list_sites'),
      }),
      // Writes current_site_id locally; validates the id against the (external) sites list.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      outputSchema: SelectSiteOutput,
    },
    async ({ site_id }) => {
      try {
        const config = await loadConfig();
        const client = new ApiClient({ api_url: config.api_url, token: config.token });
        const sites = await listSites(client);
        const site = sites.find((s) => s.site_id === site_id);
        if (!site) {
          return errorResult(
            new ValidationError(`site_id ${site_id} not found among your sites.`, {
              site_id: 'Not in your accessible sites list',
            }),
          );
        }
        await saveConfig({ ...config, current_site_id: site.site_id });
        const payload = {
          current_site_id: site.site_id,
          site_name: site.site_name,
          site_url: site.site_url,
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'pushengage_get_site_details',
    {
      title: 'Get site details',
      description:
        "Returns the current site's details, matching the dashboard's Site Details page: name, " +
        'URL, image, timezone, geolocation toggle, and the "Powered By PushEngage" branding toggle.',
      inputSchema: GetSiteDetailsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: SiteDetailsOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await getSiteDetails(client, siteId);
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
    'pushengage_update_site_details',
    {
      title: 'Update site details',
      description:
        "Updates the current site's details. Pass only the fields you want to change: site_name (Site " +
        'Name), site_url (Site URL), timezone (Website Time Zone, an IANA name), enable_geolocation ' +
        '(Enable Geolocation), and/or remove_powered_by_pushengage (Remove "Powered By PushEngage", ' +
        'which needs a paid plan). Provide at least one field. Returns the updated site details.',
      inputSchema: UpdateSiteDetailsInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      outputSchema: SiteDetailsOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const current = await getSiteDetails(client, siteId);
        const { body, result } = buildSiteDetailsUpdateBody(input, current);
        await updateSiteDetails(client, siteId, body);
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
