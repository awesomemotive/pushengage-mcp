// src/chatWidgets/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { errorResult } from '../http/errors';
import { resolveContext } from '../context';
import { ChatWidgetsListOutput } from '../output';
import { listChatWidgets } from './api';
import { chatWidgetStatusFilterCode } from './labels';
import { ListChatWidgetsInputSchema } from './schema';

export function registerChatWidgetTools(server: McpServer): void {
  server.registerTool(
    'pushengage_list_chat_widgets',
    {
      title: 'List chat widgets',
      description:
        'Lists the chat widgets on the current site, paginated (response includes `has_more`). A ' +
        'chat widget is the floating button that surfaces support channels (WhatsApp, Messenger, ' +
        'Email, etc.) on the site. Each item carries the configured channels, target devices, ' +
        'business-hours restriction, and a country/page targeting summary.',
      inputSchema: ListChatWidgetsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: ChatWidgetsListOutput,
    },
    async (input) => {
      try {
        const { client, siteId } = await resolveContext(input.site_id);
        const result = await listChatWidgets(client, siteId, {
          limit: input.limit,
          page: input.page,
          name_contains: input.name_contains,
          status: chatWidgetStatusFilterCode(input.status),
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
