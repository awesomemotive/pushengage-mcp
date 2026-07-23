// src/config.ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ConfigCorruptError } from './http/errors';

export type Config = {
  api_url: string;
  dashboard_url: string;
  token?: string;
  expires_at?: string;
  current_site_id?: number;
  client_name?: string;
};

// Production defaults. The public API is served from a dedicated host; the dashboard (where the
// browser authorize page lives) is app.pushengage.com. Both are overridable via the
// PUSHENGAGE_API_URL / PUSHENGAGE_DASHBOARD_URL env vars — e.g. to point the server at a
// non-production deployment, without the MCP itself needing to know any other URLs by name.
const DEFAULT_API_URL = 'https://dashboard-public-api.pushengage.com';
const DEFAULT_DASHBOARD_URL = 'https://app.pushengage.com';

/**
 * Path to the on-disk config file.
 *
 * - `PE_MCP_CONFIG_PATH` env var → use that exact path (escape hatch for tests, or for running
 *   more than one PushEngage account side by side with separate token files).
 * - unset → `~/.pushengage/mcp.json`
 */
export function configPath(): string {
  const override = process.env.PE_MCP_CONFIG_PATH;
  if (override) return override;
  return path.join(os.homedir(), '.pushengage', 'mcp.json');
}

export async function loadConfig(): Promise<Config> {
  // Priority: explicit URL env var > stored URL in file > hardcoded default. Explicit env vars
  // come last in the override chain below because they apply to the final value regardless of
  // whether a file existed.
  const baseDefaults: Config = {
    api_url: process.env.PUSHENGAGE_API_URL ?? DEFAULT_API_URL,
    dashboard_url: process.env.PUSHENGAGE_DASHBOARD_URL ?? DEFAULT_DASHBOARD_URL,
  };

  const file = configPath();

  // Read the file. A missing file is the normal "not logged in yet" case → use defaults.
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return baseDefaults;
    throw err;
  }

  // Parse it. A malformed file (e.g. truncated by an interrupted write, or hand-edited) would
  // otherwise throw a raw SyntaxError that leaks to every tool call as [API_ERROR] Unexpected
  // token…; surface a clear, recoverable ConfigCorruptError instead.
  let parsed: Partial<Config>;
  try {
    parsed = JSON.parse(raw) as Partial<Config>;
  } catch {
    throw new ConfigCorruptError(file);
  }

  return {
    ...baseDefaults,
    ...parsed,
    // Final URL resolution: explicit env var always wins. If no env var, prefer the stored
    // URL (user may have customized it via a previous saveConfig), and fall back to default.
    api_url: process.env.PUSHENGAGE_API_URL ?? parsed.api_url ?? baseDefaults.api_url,
    dashboard_url:
      process.env.PUSHENGAGE_DASHBOARD_URL ?? parsed.dashboard_url ?? baseDefaults.dashboard_url,
  };
}

export async function saveConfig(config: Config): Promise<void> {
  const file = configPath();
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });

  // Write to a temp file then rename for atomicity; chmod before rename.
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(config, null, 2), 'utf-8');
  if (process.platform !== 'win32') {
    await fs.chmod(tmp, 0o600);
    try {
      await fs.chmod(dir, 0o700);
    } catch {
      // Best-effort directory chmod; ignore if it fails.
    }
  }
  await fs.rename(tmp, file);
}

export async function deleteConfig(): Promise<void> {
  const file = configPath();
  try {
    await fs.unlink(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }
}

export function tokenIsExpired(config: Config, now: Date = new Date()): boolean {
  if (!config.expires_at) return true;
  const expiry = new Date(config.expires_at);
  return Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime();
}
