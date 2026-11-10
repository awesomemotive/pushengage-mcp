// src/subscriberFilter/resolve.test.ts
import type { ApiClient } from '../http/client';
import { resolveSubscriberFilter } from './resolve';
import { SubscriberFilterSchema } from './schema';

type Row = { segment_id: number; segment_name: string; status?: number };

/**
 * Stub client that answers the two listing endpoints the resolver sweeps. Records every path so
 * tests can assert that no request is made when none is needed.
 */
function stubClient(opts: { segments?: Row[]; attributeKeys?: string[] } = {}) {
  const calls: string[] = [];
  const segments = opts.segments ?? [];
  const attributeKeys = opts.attributeKeys ?? [];
  const client = {
    get: async <T>(path: string): Promise<T> => {
      calls.push(path);
      if (path.includes('/segments')) {
        return { data: segments, total: segments.length, page: 1, perPage: 100, lastPage: 1 } as T;
      }
      if (path.includes('/subscriber-attributes')) {
        const data = attributeKeys.map((key, i) => ({ id: i + 1, name: key, key }));
        return { data, total: data.length, page: 1, perPage: 100, lastPage: 1 } as T;
      }
      throw new Error(`unexpected path ${path}`);
    },
  } as unknown as ApiClient;
  return { client, calls };
}

const filterOf = (...rules: Record<string, unknown>[]) =>
  SubscriberFilterSchema.parse({ op: 'or', value: [rules] });

const SEGMENTS: Row[] = [
  { segment_id: 12, segment_name: 'Sports Fans' },
  { segment_id: 34, segment_name: 'Deal Hunters' },
  { segment_id: 56, segment_name: 'Sports Fans — Lapsed' },
];

describe('segment name resolution', () => {
  it('resolves names to ids', async () => {
    const { client } = stubClient({ segments: SEGMENTS });
    const out = await resolveSubscriberFilter(
      client,
      1,
      filterOf({ field: 'segments', op: 'in', value: ['Sports Fans', 'Deal Hunters'] }),
    );
    expect(out.filter.value[0][0].value).toEqual([12, 34]);
  });

  it('matches case-insensitively after trimming', async () => {
    const { client } = stubClient({ segments: SEGMENTS });
    const out = await resolveSubscriberFilter(
      client,
      1,
      filterOf({ field: 'segments', op: 'in', value: ['  sports FANS  '] }),
    );
    expect(out.filter.value[0][0].value).toEqual([12]);
  });

  it('does NOT substring-match — a prefix is not a hit', async () => {
    // "Sports" must not quietly resolve to "Sports Fans — Lapsed".
    const { client } = stubClient({ segments: SEGMENTS });
    await expect(
      resolveSubscriberFilter(
        client,
        1,
        filterOf({ field: 'segments', op: 'in', value: ['Sports'] }),
      ),
    ).rejects.toThrow(/no active segment named "Sports"/);
  });

  it('suggests close names when a name is not found', async () => {
    const { client } = stubClient({ segments: SEGMENTS });
    await expect(
      resolveSubscriberFilter(
        client,
        1,
        filterOf({ field: 'segments', op: 'in', value: ['Sports'] }),
      ),
    ).rejects.toThrow(/Did you mean/);
  });

  it('fails on an ambiguous name rather than picking one', async () => {
    const { client } = stubClient({
      segments: [
        { segment_id: 1, segment_name: 'VIP' },
        { segment_id: 2, segment_name: 'vip' },
      ],
    });
    await expect(
      resolveSubscriberFilter(client, 1, filterOf({ field: 'segments', op: 'in', value: ['VIP'] })),
    ).rejects.toThrow(/matches 2 segments \(ids 1, 2\)/);
  });

  // Review of PR #287 asked whether a PAUSED segment can resolve. It cannot: the list endpoint
  // is active-only at the API (Services/Dashboard/Segment.js:187 sets `status: active` with the
  // literal last, and the validator strips a `status` query param). These two tests pin the
  // invariant locally, because this module's safety depends on it: a paused id posted in a filter
  // is scrubbed by the API and the send widens to every subscriber.
  it('ignores a row that says it is paused, so the name does not resolve', async () => {
    const { client } = stubClient({
      segments: [
        { segment_id: 12, segment_name: 'Sports Fans', status: 0 },
        { segment_id: 34, segment_name: 'Deal Hunters', status: 1 },
      ],
    });
    await expect(
      resolveSubscriberFilter(
        client,
        1,
        filterOf({ field: 'segments', op: 'in', value: ['Sports Fans'] }),
      ),
    ).rejects.toThrow(/no active segment named "Sports Fans"/);

    // ...and its id is refused too, with the reason stated.
    await expect(
      resolveSubscriberFilter(client, 1, filterOf({ field: 'segments', op: 'in', value: [12] })),
    ).rejects.toThrow(/segment id 12 does not exist on this site or is not active/);
  });

  it('keeps rows that carry no status at all', async () => {
    // `toLeanSegment` makes `status` optional, so treating absent as inactive would empty the
    // index and fail every name on the site — a worse failure than the one being guarded against.
    const { client } = stubClient({ segments: SEGMENTS });
    const out = await resolveSubscriberFilter(
      client,
      1,
      filterOf({ field: 'segments', op: 'in', value: ['Sports Fans'] }),
    );
    expect(out.filter.value[0][0].value).toEqual([12]);
  });

  it('accepts numeric ids and verifies them', async () => {
    const { client } = stubClient({ segments: SEGMENTS });
    const out = await resolveSubscriberFilter(
      client,
      1,
      filterOf({ field: 'segments', op: 'all', value: [12, 34] }),
    );
    expect(out.filter.value[0][0].value).toEqual([12, 34]);
  });

  it('rejects an id that is not on the site', async () => {
    // The failure this whole module exists for: unverified, this posts and the API drops the
    // rule, widening the send to every subscriber.
    const { client } = stubClient({ segments: SEGMENTS });
    await expect(
      resolveSubscriberFilter(
        client,
        1,
        filterOf({ field: 'segments', op: 'in', value: [999999] }),
      ),
    ).rejects.toThrow(/segment id 999999 does not exist/);
  });

  it('treats a digits-only string as a name, never as an id', async () => {
    const { client } = stubClient({ segments: [{ segment_id: 7, segment_name: '34' }] });
    const out = await resolveSubscriberFilter(
      client,
      1,
      filterOf({ field: 'segments', op: 'in', value: ['34'] }),
    );
    expect(out.filter.value[0][0].value).toEqual([7]);
  });

  it('mixes names and ids in one rule', async () => {
    const { client } = stubClient({ segments: SEGMENTS });
    const out = await resolveSubscriberFilter(
      client,
      1,
      filterOf({ field: 'segments', op: 'in', value: ['Sports Fans', 34] }),
    );
    expect(out.filter.value[0][0].value).toEqual([12, 34]);
  });

  it('reports every problem at once', async () => {
    const { client } = stubClient({ segments: SEGMENTS });
    await expect(
      resolveSubscriberFilter(
        client,
        1,
        filterOf({ field: 'segments', op: 'in', value: ['Nope', 'Also Nope'] }),
      ),
    ).rejects.toThrow(/Nope[\s\S]*Also Nope/);
  });

  it('says nothing was sent, so the caller knows the push did not go out', async () => {
    const { client } = stubClient({ segments: SEGMENTS });
    await expect(
      resolveSubscriberFilter(
        client,
        1,
        filterOf({ field: 'segments', op: 'in', value: ['Nope'] }),
      ),
    ).rejects.toThrow(/nothing was sent/);
  });

  // QA P3-2 on PR #287: the message listed each problem as a bullet and then repeated the whole
  // list again as a `subscriber_filter: ...` field error, because ValidationError appends its
  // fieldErrors under the message.
  it('states each problem once', async () => {
    const { client } = stubClient({ segments: SEGMENTS });
    let message = '';
    try {
      await resolveSubscriberFilter(
        client,
        1,
        filterOf({ field: 'segments', op: 'in', value: ['Nope', 'Also Nope'] }),
      );
      throw new Error('expected a rejection');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('Nope');
    expect(message.match(/Also Nope/g)?.length).toBe(1);
    expect(message).not.toContain('subscriber_filter:');
    // One line per problem, under the summary line — no second flattened copy.
    expect(message.split('\n').filter((line) => line.includes('Also Nope')).length).toBe(1);
  });
});

describe('attribute key verification', () => {
  it('passes a known key through', async () => {
    const { client } = stubClient({ attributeKeys: ['plan', 'city'] });
    const out = await resolveSubscriberFilter(
      client,
      1,
      filterOf({ field: 'attributes', op: 'eq', value: 'gold', key: 'plan' }),
    );
    expect(out.filter.value[0][0].key).toBe('plan');
  });

  it('rejects an unknown key', async () => {
    const { client } = stubClient({ attributeKeys: ['plan'] });
    await expect(
      resolveSubscriberFilter(
        client,
        1,
        filterOf({ field: 'attributes', op: 'eq', value: 'gold', key: 'subscription_plan' }),
      ),
    ).rejects.toThrow(/no subscriber attribute with key "subscription_plan"/);
  });

  it('points at list/create attributes when there is no close match', async () => {
    const { client } = stubClient({ attributeKeys: ['country'] });
    await expect(
      resolveSubscriberFilter(
        client,
        1,
        filterOf({ field: 'attributes', op: 'exists', key: 'plan' }),
      ),
    ).rejects.toThrow(/pushengage_list_attributes/);
  });
});

describe('attribute sweep beyond the page cap', () => {
  /**
   * A client whose attribute listing never runs out of pages, so the sweep exhausts
   * MAX_LOOKUP_PAGES. Before the fix the loop just stopped and every key on a later page was
   * reported as unknown — a refused send telling the caller to create an attribute that already
   * exists (review of PR #287). Reachable: the enterprise quota is 1000 keys, with more
   * purchasable.
   */
  function endlessAttributesClient(exactKey: string) {
    const calls: string[] = [];
    const client = {
      get: async <T>(path: string): Promise<T> => {
        calls.push(path);
        const isTargeted = path.includes('key_like=');
        const rows = isTargeted
          ? decodeURIComponent(path.split('key_like=')[1].split('&')[0]) === exactKey
            ? [{ id: 1, name: exactKey, key: exactKey }]
            : []
          : Array.from({ length: 100 }, (_, i) => ({
              id: i,
              name: `filler_${i}`,
              key: `filler_${i}`,
            }));
        return {
          data: rows,
          total: 5000,
          perPage: 100,
          page: 1,
          lastPage: isTargeted ? 1 : 50,
        } as T;
      },
    } as unknown as ApiClient;
    return { client, calls };
  }

  it('verifies a key directly when the sweep runs out of pages', async () => {
    const { client, calls } = endlessAttributesClient('plan_tier');
    const out = await resolveSubscriberFilter(
      client,
      1,
      filterOf({ field: 'attributes', op: 'eq', value: 'gold', key: 'plan_tier' }),
    );
    expect(out.filter.value[0][0].key).toBe('plan_tier');
    expect(calls.filter((c) => c.includes('key_like=plan_tier'))).toHaveLength(1);
  });

  it('still refuses a key that the direct lookup cannot find either', async () => {
    const { client } = endlessAttributesClient('plan_tier');
    await expect(
      resolveSubscriberFilter(
        client,
        1,
        filterOf({ field: 'attributes', op: 'eq', value: 'gold', key: 'no_such_key' }),
      ),
    ).rejects.toThrow(/no subscriber attribute with key "no_such_key"/);
  });
});

describe('request economy', () => {
  it('makes no request when the filter needs no resolution', async () => {
    const { client, calls } = stubClient();
    const out = await resolveSubscriberFilter(
      client,
      1,
      filterOf(
        { field: 'device', op: 'in', value: ['mobile'] },
        { field: 'country', op: 'in', value: ['India'] },
      ),
    );
    expect(calls).toEqual([]);
    expect(out.filter.value[0]).toHaveLength(2);
  });

  it('fetches segments only once for many segment rules', async () => {
    const { client, calls } = stubClient({ segments: SEGMENTS });
    await resolveSubscriberFilter(
      client,
      1,
      SubscriberFilterSchema.parse({
        op: 'or',
        value: [
          [{ field: 'segments', op: 'in', value: ['Sports Fans'] }],
          [{ field: 'segments', op: 'nin', value: ['Deal Hunters'] }],
        ],
      }),
    );
    expect(calls.filter((c) => c.includes('/segments'))).toHaveLength(1);
  });

  it('fetches both lists when the filter spans segments and attributes', async () => {
    const { client, calls } = stubClient({ segments: SEGMENTS, attributeKeys: ['plan'] });
    await resolveSubscriberFilter(
      client,
      1,
      filterOf(
        { field: 'segments', op: 'in', value: ['Sports Fans'] },
        { field: 'attributes', op: 'eq', value: 'gold', key: 'plan' },
      ),
    );
    expect(calls.filter((c) => c.includes('/segments'))).toHaveLength(1);
    expect(calls.filter((c) => c.includes('/subscriber-attributes'))).toHaveLength(1);
  });
});

describe('lookup failures fail the call', () => {
  it('propagates a listing error instead of proceeding unverified', async () => {
    // A 403 is realistic here: segment read is a per-user role permission, so a sub-user with
    // send rights but no Audience access gets one. Proceeding would risk a send-to-everyone.
    const client = {
      get: async () => {
        throw new Error('403 forbidden');
      },
    } as unknown as ApiClient;
    await expect(
      resolveSubscriberFilter(client, 1, filterOf({ field: 'segments', op: 'in', value: ['X'] })),
    ).rejects.toThrow(/403/);
  });
});
