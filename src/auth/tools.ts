// src/auth/tools.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loadConfig, saveConfig, deleteConfig, tokenIsExpired } from '../config';
import { logoutSession } from './api';
import { runBrowserFlow } from './browser-flow';
import { ApiClient } from '../http/client';
import { errorResult } from '../http/errors';
import { AuthLoginOutput, AuthLogoutOutput, AuthStatusOutput } from '../output';
import { PKG_VERSION } from '../version';

// The MCP is agent-agnostic — it can be driven by Claude, ChatGPT, Cursor, Codex, or any other
// MCP-capable host. We don't try to detect which one is calling (the protocol doesn't reliably
// expose it), so we send a neutral default. Set PE_MCP_CLIENT_NAME to override with a specific
// label (e.g. "Claude Desktop") if you want it shown on the dashboard authorize screen.
const DEFAULT_CLIENT_NAME = process.env.PE_MCP_CLIENT_NAME ?? 'AI assistant';

export function registerAuthTools(server: McpServer): void {
  server.registerTool(
    'pushengage_auth_login',
    {
      title: 'Log in to PushEngage',
      description:
        'Opens a browser window to the PushEngage dashboard. After you click Authorize, an access ' +
        'token is stored locally and used for subsequent calls; the expiry is shown in the result. ' +
        'Requires a browser on the local machine. In headless or SSH environments the authorization ' +
        'URL is printed to the terminal so it can be opened manually.',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      outputSchema: AuthLoginOutput,
    },
    async () => {
      try {
        const config = await loadConfig();
        const result = await runBrowserFlow({
          dashboardUrl: config.dashboard_url,
          clientName: DEFAULT_CLIENT_NAME,
          mcpVersion: PKG_VERSION,
        });
        await saveConfig({
          ...config,
          token: result.token,
          expires_at: result.expires_at,
          client_name: DEFAULT_CLIENT_NAME,
        });
        return {
          content: [
            {
              type: 'text',
              text: `Authorized. Token stored. Expires: ${result.expires_at ?? 'unknown'}.`,
            },
          ],
          structuredContent: { authorized: true, expires_at: result.expires_at },
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'pushengage_auth_status',
    {
      title: 'Check authentication and site status',
      description:
        'Returns the current login state: authenticated (bool), expires_at (token expiry ISO ' +
        'string), current_site_id, api_url, dashboard_url, and client_name. Use this to check ' +
        'whether pushengage_auth_login is needed before making other calls.',
      inputSchema: z.object({}),
      // Reads only local config (token presence + selected site); no network call.
      annotations: { readOnlyHint: true, openWorldHint: false },
      outputSchema: AuthStatusOutput,
    },
    async () => {
      try {
        const config = await loadConfig();
        const authenticated = !!config.token && !tokenIsExpired(config);
        const payload = {
          authenticated,
          api_url: config.api_url,
          dashboard_url: config.dashboard_url,
          expires_at: config.expires_at,
          current_site_id: config.current_site_id,
          client_name: config.client_name,
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

  server.registerTool(
    'pushengage_auth_logout',
    {
      title: 'Log out',
      description:
        'Revokes the current PushEngage session on the server and deletes the locally stored token. ' +
        'After this call, all site-scoped tools require pushengage_auth_login before they can be used again.',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      outputSchema: AuthLogoutOutput,
    },
    async () => {
      try {
        const config = await loadConfig();
        let serverSessionRevoked: boolean | null = null;

        if (config.token) {
          const client = new ApiClient({ api_url: config.api_url, token: config.token });
          try {
            const result = await logoutSession(client);
            serverSessionRevoked = result.logout === true;
          } catch {
            // Session may already be invalid — still clear local storage.
            serverSessionRevoked = false;
          }
        }

        await deleteConfig();

        const payload = { status: 'logged_out', server_session_revoked: serverSessionRevoked };
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
