#!/usr/bin/env node
// Builds the MCP Bundle (.mcpb) for one-click installation in Claude Desktop.
//
// Stages the runtime files (manifest.json, dist/, package.json, production
// node_modules) into a clean directory so the archive never picks up sources,
// tests, or dev dependencies, then packs it with @anthropic-ai/mcpb.
//
// Output: pushengage-mcp-<version>.mcpb at the repo root.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));

// The manifest version must track package.json; sync it rather than drift.
if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest.json version synced to ${pkg.version}`);
}

console.log('Compiling TypeScript…');
run('npm', ['run', 'build']);

const staging = mkdtempSync(path.join(tmpdir(), 'pushengage-mcpb-'));
try {
  console.log(`Staging bundle contents in ${staging}…`);
  // dist/version.ts resolves package.json one level above dist/, so the
  // bundle must mirror the repo-root layout.
  for (const entry of ['manifest.json', 'icon.png', 'package.json', 'package-lock.json', 'dist', 'LICENSE', 'README.md', 'CHANGELOG.md']) {
    cpSync(path.join(root, entry), path.join(staging, entry), { recursive: true });
  }

  console.log('Installing production dependencies…');
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: staging,
  });

  console.log('Validating manifest and packing…');
  run('npx', ['--yes', '@anthropic-ai/mcpb@latest', 'validate', 'manifest.json'], { cwd: staging });
  const outFile = path.join(root, `pushengage-mcp-${pkg.version}.mcpb`);
  run('npx', ['--yes', '@anthropic-ai/mcpb@latest', 'pack', staging, outFile]);

  console.log(`\nDone: ${outFile}`);
  console.log('Install it by opening the file with Claude Desktop (double-click or drag onto the window).');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
