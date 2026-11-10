// src/audienceFilterValues/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { resolveContext } from '../context';
import { errorResult } from '../http/errors';
import { AudienceFilterValuesOutput } from '../output';
import { listAudienceFilterValues } from './api';
import { ListAudienceFilterValuesInputSchema } from './schema';

export function registerAudienceFilterValueTools(server: McpServer): void {
  server.registerTool(
    'pushengage_list_audience_filter_values',
    {
      title: 'List values for custom-audience filter fields',
      description:
        'Lists the location and device values recorded on this site, with how many active ' +
        'subscribers carry each one. These are the values a `subscriber_filter` rule can use for ' +
        'the country, state, city, device and device_type fields — the "Custom Audience" ' +
        'targeting on the send tools and pushengage_create_audience_group. ' +
        'Call this BEFORE writing a rule on any of those five fields. Locations are display names ' +
        'taken from the subscribers themselves, not ISO codes, and they differ per site — "US", ' +
        '"USA" and "United States" are not interchangeable, and a guessed spelling produces a ' +
        'notification that saves successfully and reaches the wrong people. The subscriber counts ' +
        'also show whether a filter is worth sending at all. ' +
        'For the other two filter vocabularies use pushengage_list_segments (segment names) and ' +
        'pushengage_list_attributes (attribute keys).',
      inputSchema: ListAudienceFilterValuesInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: AudienceFilterValuesOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await listAudienceFilterValues(client, siteId, input);
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
