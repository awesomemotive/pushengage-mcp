// src/context.test.ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { saveConfig } from './config';
import { resolveContext } from './context';
import { NoSiteSelectedError } from './http/errors';

describe('resolveContext', () => {
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'pe-mcp-ctx-'));
    process.env.PE_MCP_CONFIG_PATH = path.join(tmpHome, 'mcp.json');
  });

  afterEach(async () => {
    delete process.env.PE_MCP_CONFIG_PATH;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  const baseConfig = {
    api_url: 'https://app.pushengage.com',
    dashboard_url: 'https://app.pushengage.com',
    token: 'JWT',
  };

  it('throws NoSiteSelectedError when neither an explicit id nor a saved site exists', async () => {
    await expect(resolveContext()).rejects.toBeInstanceOf(NoSiteSelectedError);
  });

  it('prefers an explicit site_id over the saved current site', async () => {
    await saveConfig({ ...baseConfig, current_site_id: 10 });
    const ctx = await resolveContext(42);
    expect(ctx.siteId).toBe(42);
  });

  it('falls back to the saved current site when no site_id is given', async () => {
    await saveConfig({ ...baseConfig, current_site_id: 10 });
    const ctx = await resolveContext();
    expect(ctx.siteId).toBe(10);
  });
});
