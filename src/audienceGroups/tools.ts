// src/audienceGroups/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { errorResult } from '../http/errors';
import { resolveContext } from '../context';
import { AudienceGroupsListOutput, CreateAudienceGroupOutput } from '../output';
import { createAudienceGroup, listAudienceGroups } from './api';
import {
  CreateAudienceGroupInputSchema,
  ListAudienceGroupsInputSchema,
  toCreateAudienceGroupApiBody,
} from './schema';

export function registerAudienceGroupTools(server: McpServer): void {
  server.registerTool(
    'pushengage_list_audience_groups',
    {
      title: 'List audience groups',
      description:
        'Lists audience groups on the current site, paginated (response includes `has_more`). ' +
        'Use this to look up audience-group IDs when the user references a group by name; those IDs ' +
        'are what pushengage_send_notification / pushengage_send_ab_notification accept in their ' +
        '`audience_groups` field.',
      inputSchema: ListAudienceGroupsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: AudienceGroupsListOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await listAudienceGroups(client, siteId, {
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
    'pushengage_create_audience_group',
    {
      title: 'Create an audience group',
      description:
        'Creates a new audience group on the current site. Required: `name` and `filter`. The `filter` is a ' +
        'subscriber-filter expression — { op: "or" | "and" (default "or"), value: 2-D array of rule groups }. ' +
        'Each rule is { field, op, value?, key? }. Rules WITHIN a group are AND-ed; groups in `value` are combined ' +
        'with the top-level `op`. See the inputSchema field descriptions for the supported `field` and `op` enums. ' +
        'Common patterns: ' +
        '"Mobile subscribers" → filter={ op: "or", value: [[{ field: "device", op: "in", value: ["mobile"] }]] }. ' +
        '"Subscribed in the last 7 days" → filter={ op: "or", value: [[{ field: "ts_created", op: "ts_elapsed_lt", value: 604800 }]] }. ' +
        '"Highly engaged" (≥20 sent AND ≥2 clicks) → filter={ op: "or", value: [[{ field: "sent_count", op: "gt", value: 20 }, { field: "click_count", op: "gt", value: 2 }]] }. ' +
        'Only set description and complex filters when the user explicitly describes them.',
      inputSchema: CreateAudienceGroupInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      outputSchema: CreateAudienceGroupOutput,
    },
    async (input) => {
      try {
        const { client, siteId, config } = await resolveContext(input.site_id);
        const body = toCreateAudienceGroupApiBody(input);
        const created = await createAudienceGroup(client, siteId, body);
        const viewUrl = `${config.dashboard_url}/sites/${siteId}/audiences/audience-groups/${created.id ?? ''}`;
        const payload = {
          id: created.id,
          name: created.name ?? body.name,
          description: created.description ?? body.description,
          filter: created.filter ?? body.filter,
          view_url: viewUrl,
          // Echo back the id so the user (and the assistant in a follow-up call) can
          // immediately pass it as an audience_groups entry to pushengage_send_notification.
          use_with_send_notification: {
            audience_groups: created.id ? [created.id] : undefined,
          },
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
