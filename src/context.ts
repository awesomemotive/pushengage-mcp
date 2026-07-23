// src/context.ts
import { type Config, loadConfig } from './config';
import { ApiClient } from './http/client';
import { NoSiteSelectedError } from './http/errors';

export type ToolContext = {
  client: ApiClient;
  siteId: number;
  config: Config;
};

/**
 * Shared prelude for site-scoped tools: load config, resolve the target site (an explicit
 * `site_id` argument wins over the saved current site), and build an authenticated client.
 * Throws NoSiteSelectedError when neither an explicit id nor a selected site is available, so
 * every tool surfaces the same "call pushengage_list_sites then pushengage_select_site" hint.
 */
export async function resolveContext(inputSiteId?: number): Promise<ToolContext> {
  const config = await loadConfig();
  const siteId = inputSiteId ?? config.current_site_id;
  if (!siteId) {
    throw new NoSiteSelectedError();
  }
  const client = new ApiClient({ api_url: config.api_url, token: config.token });
  return { client, siteId, config };
}
