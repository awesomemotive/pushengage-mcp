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

    expect(tools.length).toBe(27);
    for (const tool of tools) {
      expect(tool.name.startsWith('pushengage_')).toBe(true);
      expect(tool.outputSchema).toBeDefined();
    }

    await client.close();
    await server.close();
  });
});
