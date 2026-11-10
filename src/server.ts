// src/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAnalyticsTools } from './analytics/tools';
import { registerAttributeTools } from './attributes/tools';
import { registerAudienceGroupTools } from './audienceGroups/tools';
import { registerAuthTools } from './auth/tools';
import { registerCampaignTools } from './campaigns/tools';
import { registerChatWidgetTools } from './chatWidgets/tools';
import { registerAudienceFilterValueTools } from './audienceFilterValues/tools';
import { registerNotificationTools } from './notifications/tools';
import { registerSegmentTools } from './segments/tools';
import { registerSiteSettingsTools } from './siteSettings/tools';
import { registerSiteTools } from './sites/tools';
import { PKG_VERSION } from './version';

export function createServer(): McpServer {
  const server = new McpServer({ name: 'pushengage', version: PKG_VERSION });
  registerAuthTools(server);
  registerSiteTools(server);
  registerSiteSettingsTools(server);
  registerSegmentTools(server);
  registerAttributeTools(server);
  // Location/device value lookup backs the custom-audience filter rules on the send tools and on
  // audience groups, so it sits with the other audience-vocabulary tools (segments, attributes)
  // rather than next to notifications.
  registerAudienceFilterValueTools(server);
  registerAudienceGroupTools(server);
  registerNotificationTools(server);
  registerAnalyticsTools(server);
  registerCampaignTools(server);
  registerChatWidgetTools(server);
  return server;
}
