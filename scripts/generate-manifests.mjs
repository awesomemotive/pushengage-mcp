#!/usr/bin/env node
// Regenerates the two hand-published tool catalogues from the running server:
//
//   lhm.plugin.json  — the plugin-directory listing: the full listTools() payload
//                      (description, title, annotations, execution, input/output
//                      schemas) wrapped in this plugin's own metadata.
//   manifest.json    — the .mcpb bundle manifest: `tools` is a display list of
//                      { name, description }, where the description is the FIRST
//                      SENTENCE of the tool's description. Everything else in the
//                      file is hand-maintained and is left exactly as it is.
//
// Why this exists: both files carry a tool list that nothing enforced. By 1.2.0,
// lhm.plugin.json still said version 1.1.0 with 28 tools and manifest.json listed
// 27, against 32 registered — so a release would have advertised the new version
// while describing the old one's tools. The 1.1.0 changelog already claimed this
// file "is generated from the running server, so its tool list cannot drift"; no
// generator was ever checked in. This is that generator.
//
// Run it after adding or changing a tool, and before a release.
//
// Usage: node scripts/generate-manifests.mjs [--check]
//   --check  exits non-zero if either file is out of date, writing nothing.
//            Suitable for CI or a pre-release gate.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

// The tools are read from the COMPILED server, so what is published is what was
// built — the same artifact the npm package ships.
console.log('Compiling TypeScript…');
execFileSync('npm', ['run', 'build'], { stdio: 'inherit', cwd: root });

const { createServer } = await import(path.join(root, 'dist/server.js'));

/** The tool list exactly as a client receives it. */
async function readTools() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'generate-manifests', version: pkg.version });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  return tools;
}

/**
 * The first sentence of a tool description, for the bundle manifest's display list.
 *
 * Splits on ". " rather than "." so decimals, "e.g." and "a.m." do not cut the line
 * short, and keeps the terminating period.
 */
function firstSentence(description) {
  const match = /^(.*?\.)(?:\s|$)/s.exec(description);
  return (match ? match[1] : description).trim();
}

/**
 * Both files are checked in and formatted by biome (the pre-commit hook runs
 * `biome check --write` on JSON), so the generated text is put through the same
 * formatter before being compared or written. Otherwise plain JSON.stringify
 * expands every short array that biome keeps on one line, and --check reports a
 * file as stale on every run.
 */
function formatted(text, filePath) {
  return execFileSync('npx', ['biome', 'format', '--stdin-file-path', filePath], {
    input: text,
    encoding: 'utf8',
    cwd: root,
  });
}

/** Stable key order, so a regeneration produces no incidental diff. */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeysDeep(value[k])]),
    );
  }
  return value;
}

const tools = await readTools();
console.log(`Server registers ${tools.length} tools.`);

// ---- lhm.plugin.json: wrapper metadata kept, tools and version regenerated ----
const lhmPath = path.join(root, 'lhm.plugin.json');
const lhm = JSON.parse(readFileSync(lhmPath, 'utf8'));
const lhmNext = sortKeysDeep({ ...lhm, version: pkg.version, tools });
const lhmText = `${JSON.stringify(lhmNext, null, 2)}\n`;

// ---- manifest.json: ONLY the tools array is rewritten, in place ----
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const manifestNext = {
  ...manifest,
  version: pkg.version,
  tools: tools.map((t) => ({ name: t.name, description: firstSentence(t.description) })),
};
const manifestText = `${JSON.stringify(manifestNext, null, 2)}\n`;

const files = [
  { label: 'lhm.plugin.json', filePath: lhmPath, text: formatted(lhmText, lhmPath) },
  { label: 'manifest.json', filePath: manifestPath, text: formatted(manifestText, manifestPath) },
];

let stale = false;
for (const { label, filePath, text } of files) {
  const current = readFileSync(filePath, 'utf8');
  if (current === text) {
    console.log(`${label}: already up to date.`);
    continue;
  }
  stale = true;
  if (CHECK_ONLY) {
    console.error(`${label}: OUT OF DATE — run 'node scripts/generate-manifests.mjs'.`);
  } else {
    writeFileSync(filePath, text);
    console.log(`${label}: rewritten (${tools.length} tools, version ${pkg.version}).`);
  }
}

if (CHECK_ONLY && stale) process.exit(1);
if (!stale) console.log('Nothing to do.');
