// src/campaigns/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { errorResult } from '../http/errors';
import { resolveContext } from '../context';
import { CampaignsListOutput, WorkflowsListOutput } from '../output';
import { listDripCampaigns, listRssCampaigns, listTriggeredCampaigns, listWorkflows } from './api';
import {
  dripStatusFilterCode,
  rssStatusFilterCode,
  triggerStatusFilterCode,
  workflowStatusFilterCode,
} from './labels';
import {
  ListDripCampaignsInputSchema,
  ListRssCampaignsInputSchema,
  ListTriggeredCampaignsInputSchema,
  ListWorkflowsInputSchema,
} from './schema';

const STATUS_FILTER_HELP =
  'Optionally filter by status (default "all" = every status), mirroring the dashboard filter tabs.';

const ANALYTICS_HELP =
  'Set include_analytics=true only when the user asks for stats/performance (it costs an extra ' +
  'analytics lookup per page).';

export function registerCampaignTools(server: McpServer): void {
  server.registerTool(
    'pushengage_list_drip_campaigns',
    {
      title: 'List drip campaigns',
      description:
        'Lists the drip autoresponder campaigns on the current site, paginated (response includes ' +
        `\`has_more\`). ${STATUS_FILTER_HELP} ${ANALYTICS_HELP} ` +
        'Each item then also carries an analytics object: sent, seen, clicked, ctr, goal_count, goal_value.',
      inputSchema: ListDripCampaignsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: CampaignsListOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await listDripCampaigns(client, siteId, {
          limit: input.limit,
          page: input.page,
          status: dripStatusFilterCode(input.status),
          includeAnalytics: input.include_analytics,
        });
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
    'pushengage_list_triggered_campaigns',
    {
      title: 'List triggered campaigns',
      description:
        'Lists the triggered campaigns (Price Drop / Inventory Alert / Cart Abandonment / etc.) on ' +
        `the current site, paginated (response includes \`has_more\`). ${STATUS_FILTER_HELP} ` +
        `${ANALYTICS_HELP} Each item then also carries an analytics object: sent, seen, clicked, ctr, ` +
        'goal_count, goal_value.',
      inputSchema: ListTriggeredCampaignsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: CampaignsListOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await listTriggeredCampaigns(client, siteId, {
          limit: input.limit,
          page: input.page,
          status: triggerStatusFilterCode(input.status),
          includeAnalytics: input.include_analytics,
        });
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
    'pushengage_list_rss_campaigns',
    {
      title: 'List RSS auto push campaigns',
      description:
        'Lists the RSS auto push campaigns on the current site, paginated (response includes ' +
        `\`has_more\`). Each item includes the feed_url. ${STATUS_FILTER_HELP}`,
      inputSchema: ListRssCampaignsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: CampaignsListOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await listRssCampaigns(client, siteId, {
          limit: input.limit,
          page: input.page,
          status: rssStatusFilterCode(input.status),
        });
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
    'pushengage_list_workflows',
    {
      title: 'List workflow automations',
      description:
        'Lists the workflow automations on the current site, paginated (response includes ' +
        `\`has_more\`). ${STATUS_FILTER_HELP} ${ANALYTICS_HELP} Each item then also carries an ` +
        'analytics object: entered, active, completed, failed (user counts), goal_count, goal_value.',
      inputSchema: ListWorkflowsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: WorkflowsListOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await listWorkflows(client, siteId, {
          limit: input.limit,
          page: input.page,
          status: workflowStatusFilterCode(input.status),
          includeAnalytics: input.include_analytics,
        });
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
