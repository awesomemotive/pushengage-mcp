// src/analytics/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { errorResult } from '../http/errors';
import { resolveContext } from '../context';
import { AnalyticsSummaryOutput, AnalyticsTimeseriesOutput } from '../output';
import { getAnalyticsSummary, getAnalyticsTimeseries } from './api';
import {
  GetAnalyticsSummaryInputSchema,
  GetAnalyticsTimeseriesInputObject,
  GetAnalyticsTimeseriesInputSchema,
} from './schema';

export function registerAnalyticsTools(server: McpServer): void {
  server.registerTool(
    'pushengage_get_analytics_summary',
    {
      title: 'Get all-time analytics totals',
      description:
        "Returns the current site's all-time, site-wide totals: subscribers (current active " +
        'count), notifications sent, views, clicks, and goal conversions/value. Not bounded by ' +
        'any date range — for trends over a period use pushengage_get_analytics_timeseries instead.',
      inputSchema: GetAnalyticsSummaryInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: AnalyticsSummaryOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const summary = await getAnalyticsSummary(client, siteId);
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
          structuredContent: summary,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'pushengage_get_analytics_timeseries',
    {
      title: 'Get analytics over a date range',
      description:
        "Returns a time series of the current site's analytics between start_date and end_date, " +
        'bucketed by group_by. Each point has subscribers gained, notifications sent, views, ' +
        'clicks, ctr, and unsubscribes for that bucket. Use this for trends or metrics over a ' +
        'period; for all-time totals use pushengage_get_analytics_summary instead.',
      // Register the plain object so the SDK exposes the params; re-parse below for the
      // cross-field rule (end_date >= start_date).
      inputSchema: GetAnalyticsTimeseriesInputObject,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: AnalyticsTimeseriesOutput,
    },
    async (rawInput) => {
      try {
        const input = GetAnalyticsTimeseriesInputSchema.parse(rawInput);
        const { client, siteId } = await resolveContext(input.site_id);
        const points = await getAnalyticsTimeseries(client, siteId, {
          start_date: input.start_date,
          end_date: input.end_date,
          group_by: input.group_by,
        });
        const payload = {
          group_by: input.group_by,
          start_date: input.start_date,
          end_date: input.end_date,
          count: points.length,
          points,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
