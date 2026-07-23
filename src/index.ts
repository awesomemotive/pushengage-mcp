#!/usr/bin/env node
// src/index.ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from './server';

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // IMPORTANT: stdout is reserved for the JSON-RPC channel; log to stderr.
  console.error('@pushengage/mcp ready on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
