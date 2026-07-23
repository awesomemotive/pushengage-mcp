// src/attributes/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { errorResult } from '../http/errors';
import { resolveContext } from '../context';
import { AttributesListOutput, CreateAttributeOutput } from '../output';
import { createAttribute, listAttributes } from './api';
import {
  CreateAttributeInputSchema,
  ListAttributesInputSchema,
  toCreateAttributeApiBody,
} from './schema';

export function registerAttributeTools(server: McpServer): void {
  server.registerTool(
    'pushengage_list_attributes',
    {
      title: 'List subscriber attributes',
      description:
        'Lists subscriber attributes (custom keys set on subscribers via the JS SDK) on the current ' +
        'site, paginated (response includes `has_more`). Use this to discover attribute `key` values ' +
        'before constructing an audience-group filter rule with field="attributes".',
      inputSchema: ListAttributesInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: AttributesListOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await listAttributes(client, siteId, {
          limit: input.limit,
          page: input.page,
          key_contains: input.key_contains,
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
    'pushengage_create_attribute',
    {
      title: 'Create a subscriber attribute',
      description:
        'Creates a new subscriber attribute on the current site. Required: `name` (human-readable label, e.g. ' +
        '"Customer Plan") and `key` (machine identifier, e.g. "plan"). The `key` must start with a letter and ' +
        'contain only letters, numbers, hyphens, and underscores. The created `key` becomes a usable value for ' +
        'audience-group rules with field="attributes" (the rule\'s `key` property). ' +
        'PushEngage caps each site at 50 attributes; the API returns 422 if the limit is exceeded.',
      inputSchema: CreateAttributeInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      outputSchema: CreateAttributeOutput,
    },
    async (input) => {
      try {
        const { client, siteId, config } = await resolveContext(input.site_id);
        const body = toCreateAttributeApiBody(input);
        const created = await createAttribute(client, siteId, body);
        const viewUrl = `${config.dashboard_url}/sites/${siteId}/audiences/attributes`;
        const payload = {
          id: created.id,
          name: created.name ?? body.name,
          key: created.key ?? body.key,
          status: created.status,
          view_url: viewUrl,
          // Echo back the key so the LLM can immediately plug it into an
          // audience-group rule with field="attributes".
          use_with_audience_group_rule: created.key
            ? { field: 'attributes', key: created.key }
            : undefined,
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
