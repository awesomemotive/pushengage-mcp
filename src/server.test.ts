// src/server.test.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from './server';

describe('createServer', () => {
  it('registers every tool namespaced and exposes an outputSchema on each', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // listTools forces the SDK to convert every tool's Zod outputSchema to JSON Schema; a schema
    // the SDK can't serialize would throw here rather than only failing live in a client.
    const { tools } = await client.listTools();

    expect(tools.length).toBe(28);
    for (const tool of tools) {
      expect(tool.name.startsWith('pushengage_')).toBe(true);
      expect(tool.outputSchema).toBeDefined();
    }

    await client.close();
    await server.close();
  });

  // Regression guard for the PR #287 QA finding (P0-1). `ts_elapsed_lt` / `ts_elapsed_gt` are
  // counts of MINUTES — the delivery engine multiplies by 60000
  // (pushengage-node pe-modules/criteria-parser/mongo-parser.js) and the dashboard's own input
  // emits `days * 60 * 24`. The MCP shipped 1.1.0 telling the model they were seconds, which
  // targeted a 60x-wrong audience on every relative-date filter.
  //
  // The unit only ever existed in prose, so prose is what has to be pinned: this walks the tool
  // definitions exactly as a client receives them, descriptions and input schemas alike.
  it('never describes ts_elapsed_* in seconds', async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();

    const strings: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === 'string') strings.push(node);
      else if (Array.isArray(node)) for (const v of node) walk(v);
      else if (node && typeof node === 'object') for (const v of Object.values(node)) walk(v);
    };
    walk(tools);

    const elapsedStrings = strings.filter((v) => v.includes('ts_elapsed'));
    // Guard against a vacuous pass: the ops must still be described somewhere.
    expect(elapsedStrings.length).toBeGreaterThan(0);
    expect(elapsedStrings.some((v) => /minute/i.test(v))).toBe(true);

    for (const text of elapsedStrings) {
      expect({ text, claimsSeconds: /second/i.test(text) }).toEqual({ text, claimsSeconds: false });
    }

    // 604800 was the old "7 days in seconds" example. In minutes seven days is 10080, and 604800
    // would mean 420 days.
    expect(strings.some((v) => v.includes('604800'))).toBe(false);

    await client.close();
    await server.close();
  });
});
