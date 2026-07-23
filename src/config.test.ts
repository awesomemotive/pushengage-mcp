// src/config.test.ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig, saveConfig, deleteConfig, configPath } from './config';
import { ConfigCorruptError } from './http/errors';

describe('config', () => {
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'pe-mcp-'));
    process.env.PE_MCP_CONFIG_PATH = path.join(tmpHome, 'mcp.json');
  });

  afterEach(async () => {
    delete process.env.PE_MCP_CONFIG_PATH;
    delete process.env.PUSHENGAGE_API_URL;
    delete process.env.PUSHENGAGE_DASHBOARD_URL;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig();
    expect(config.api_url).toBe('https://dashboard-public-api.pushengage.com');
    expect(config.dashboard_url).toBe('https://app.pushengage.com');
    expect(config.token).toBeUndefined();
    expect(config.current_site_id).toBeUndefined();
  });

  it('throws ConfigCorruptError when the config file is malformed JSON', async () => {
    await fs.writeFile(process.env.PE_MCP_CONFIG_PATH as string, '{ "token": "abc"', 'utf-8');
    await expect(loadConfig()).rejects.toBeInstanceOf(ConfigCorruptError);
  });

  it('honors env var overrides for URLs', async () => {
    process.env.PUSHENGAGE_API_URL = 'https://custom-api.example.com';
    process.env.PUSHENGAGE_DASHBOARD_URL = 'https://custom-dashboard.example.com';
    try {
      const config = await loadConfig();
      expect(config.api_url).toBe('https://custom-api.example.com');
      expect(config.dashboard_url).toBe('https://custom-dashboard.example.com');
    } finally {
      delete process.env.PUSHENGAGE_API_URL;
      delete process.env.PUSHENGAGE_DASHBOARD_URL;
    }
  });

  it('saves and reloads', async () => {
    await saveConfig({
      api_url: 'https://app.pushengage.com',
      dashboard_url: 'https://app.pushengage.com',
      token: 'JWT',
      expires_at: '2026-05-31T00:00:00Z',
      current_site_id: 42,
      client_name: 'Claude Desktop',
    });
    const reloaded = await loadConfig();
    expect(reloaded.token).toBe('JWT');
    expect(reloaded.current_site_id).toBe(42);
  });

  it('writes config file with 0600 permissions on POSIX', async () => {
    if (process.platform === 'win32') return; // skip on Windows
    await saveConfig({
      api_url: 'https://app.pushengage.com',
      dashboard_url: 'https://app.pushengage.com',
      token: 'JWT',
    });
    const stat = await fs.stat(configPath());
    // Mode bits 0o777; want exactly 0o600.
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('deleteConfig removes the file', async () => {
    await saveConfig({
      api_url: 'https://app.pushengage.com',
      dashboard_url: 'https://app.pushengage.com',
      token: 'JWT',
    });
    await deleteConfig();
    const config = await loadConfig();
    expect(config.token).toBeUndefined();
  });

  describe('configPath', () => {
    it('defaults to ~/.pushengage/mcp.json when PE_MCP_CONFIG_PATH is unset', () => {
      delete process.env.PE_MCP_CONFIG_PATH;
      try {
        expect(configPath()).toMatch(/[/\\]\.pushengage[/\\]mcp\.json$/);
      } finally {
        process.env.PE_MCP_CONFIG_PATH = path.join(tmpHome, 'mcp.json');
      }
    });

    it('PE_MCP_CONFIG_PATH overrides the default path exactly', () => {
      // PE_MCP_CONFIG_PATH is already set to tmpHome/mcp.json by beforeEach.
      expect(configPath()).toBe(path.join(tmpHome, 'mcp.json'));
    });

    it('separate config paths isolate tokens', async () => {
      const tmpA = path.join(tmpHome, 'mcp-a.json');
      const tmpB = path.join(tmpHome, 'mcp-b.json');

      process.env.PE_MCP_CONFIG_PATH = tmpA;
      await saveConfig({
        api_url: 'https://app.pushengage.com',
        dashboard_url: 'https://app.pushengage.com',
        token: 'TOKEN_A',
      });

      process.env.PE_MCP_CONFIG_PATH = tmpB;
      const configB = await loadConfig();
      expect(configB.token).toBeUndefined();
    });
  });
});
