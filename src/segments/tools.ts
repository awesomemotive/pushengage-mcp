// src/segments/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { errorResult } from '../http/errors';
import { resolveContext } from '../context';
import { CreateSegmentOutput, SegmentsListOutput } from '../output';
import { createSegment, listSegments } from './api';
import {
  CreateSegmentInputSchema,
  ListSegmentsInputSchema,
  toCreateSegmentApiBody,
} from './schema';

export function registerSegmentTools(server: McpServer): void {
  server.registerTool(
    'pushengage_list_segments',
    {
      title: 'List segments',
      description:
        'Lists segments on the current site, paginated (response includes `has_more`). Each item ' +
        'carries segment_id, name, current subscriber count, status, and any URL matching criteria.',
      inputSchema: ListSegmentsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: SegmentsListOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await listSegments(client, siteId, {
          limit: input.limit,
          page: input.page,
          name_contains: input.name_contains,
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
    'pushengage_create_segment',
    {
      title: 'Create a segment',
      description:
        'Creates a new segment on the current site. Required: segment_name. ' +
        'Optionally pass segment_criteria with URL `include` and/or `exclude` rules to define what ' +
        'subscribers belong to the segment — each rule is `{ rule: "start" | "exact" | "contains", value: "<url>" }`. ' +
        'By default, segment criteria are evaluated only when a visitor subscribes to push notifications. ' +
        'Set add_segment_on_page_load=true (Segment on Page Visit) to evaluate those criteria on every page visit instead, ' +
        'so segment membership can change as subscribers browse the site. ' +
        'Only include segment_criteria and add_segment_on_page_load when the user explicitly describes the matching rules.',
      inputSchema: CreateSegmentInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      outputSchema: CreateSegmentOutput,
    },
    async (input) => {
      try {
        const { client, siteId, config } = await resolveContext(input.site_id);
        const body = toCreateSegmentApiBody(input);
        const created = await createSegment(client, siteId, body);
        const viewUrl = `${config.dashboard_url}/sites/${siteId}/audiences/segments/${created.segment_id ?? ''}`;
        const payload = {
          segment_id: created.segment_id,
          segment_name: created.segment_name ?? body.segment_name,
          segment_criteria: created.segment_criteria ?? body.segment_criteria,
          add_segment_on_page_load: Boolean(
            created.add_segment_on_page_load ?? body.add_segment_on_page_load,
          ),
          view_url: viewUrl,
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
