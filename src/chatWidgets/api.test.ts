// src/chatWidgets/api.test.ts
import type { ApiClient } from '../http/client';
import { __testing__, listChatWidgets } from './api';

const { adaptChatWidgetsEnvelope } = __testing__;

describe('adaptChatWidgetsEnvelope', () => {
  it('handles a paginated { data, total, perPage, page, lastPage } envelope', () => {
    const result = adaptChatWidgetsEnvelope(
      {
        data: [
          { id: 1, name: 'A', status: 'enabled', config: {} },
          { id: 2, name: 'B', status: 'disabled', config: {} },
        ],
        total: 12,
        perPage: 10,
        page: 1,
        lastPage: 2,
      },
      1,
      10,
    );
    expect(result.chat_widgets).toHaveLength(2);
    expect(result.chat_widgets[0]).toMatchObject({ id: 1, name: 'A', status: 'Active' });
    expect(result.total).toBe(12);
    expect(result.last_page).toBe(2);
    expect(result.has_more).toBe(true);
  });

  it('reports has_more=false on the last page', () => {
    const result = adaptChatWidgetsEnvelope(
      { data: [{ id: 1, name: 'Only', status: 'enabled' }], total: 1, page: 1, lastPage: 1 },
      1,
      10,
    );
    expect(result.has_more).toBe(false);
  });

  it('handles a bare array (no envelope) and infers has_more from a full page', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: `W${i}`,
      status: 'enabled',
    }));
    const result = adaptChatWidgetsEnvelope(rows, 1, 10);
    expect(result.chat_widgets).toHaveLength(10);
    expect(result.has_more).toBe(true);
  });

  it('returns an empty page for unrecognized shapes', () => {
    const result = adaptChatWidgetsEnvelope({ unexpected: true }, 1, 10);
    expect(result.chat_widgets).toEqual([]);
    expect(result.has_more).toBe(false);
  });
});

/** Minimal fake client that records the path it was called with and returns a fixed body. */
function fakeClient(body: unknown): { client: ApiClient; calls: string[] } {
  const calls: string[] = [];
  const client = {
    get: async (path: string) => {
      calls.push(path);
      return body;
    },
  } as unknown as ApiClient;
  return { client, calls };
}

describe('listChatWidgets', () => {
  it('sends limit + page, omits name/status by default', async () => {
    const { client, calls } = fakeClient({ data: [] });
    await listChatWidgets(client, 30, { limit: 10, page: 1 });
    expect(calls[0]).toBe('/sites/30/chat-widgets?limit=10&page=1');
  });

  it('passes name (substring) and raw status filter', async () => {
    const { client, calls } = fakeClient({ data: [] });
    await listChatWidgets(client, 30, {
      limit: 25,
      page: 2,
      name_contains: 'support',
      status: 'enabled',
    });
    expect(calls[0]).toContain('limit=25');
    expect(calls[0]).toContain('page=2');
    expect(calls[0]).toContain('name=support');
    expect(calls[0]).toContain('status=enabled');
  });
});
