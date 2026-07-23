// src/attributes/api.test.ts
import { __testing__ } from './api';

const { adaptAttributesEnvelope } = __testing__;

describe('adaptAttributesEnvelope', () => {
  it('handles a paginated { data, total, perPage, page, lastPage } envelope', () => {
    const result = adaptAttributesEnvelope(
      {
        data: [
          {
            id: 1,
            name: 'Customer Plan',
            key: 'plan',
            status: 1,
            created_at: '2026-05-01T00:00:00.000Z',
          },
          { id: 2, name: 'Signup Source', key: 'signup_source', status: 1 },
        ],
        total: 12,
        perPage: 10,
        page: 1,
        lastPage: 2,
      },
      1,
      10,
    );
    expect(result.attributes).toHaveLength(2);
    expect(result.attributes[0]).toEqual({
      id: 1,
      name: 'Customer Plan',
      key: 'plan',
      status: 1,
      created_at: '2026-05-01T00:00:00.000Z',
    });
    expect(result.total).toBe(12);
    expect(result.last_page).toBe(2);
    expect(result.has_more).toBe(true);
  });

  it('reports has_more=false on the last page', () => {
    const result = adaptAttributesEnvelope(
      { data: [{ id: 1, name: 'Only', key: 'only' }], total: 1, page: 1, lastPage: 1 },
      1,
      10,
    );
    expect(result.has_more).toBe(false);
  });

  it('handles a bare array fallback', () => {
    const result = adaptAttributesEnvelope(
      [
        { id: 1, name: 'A', key: 'a' },
        { id: 2, name: 'B', key: 'b' },
      ],
      1,
      10,
    );
    expect(result.attributes).toHaveLength(2);
    expect(result.has_more).toBe(false);
  });

  it('infers has_more=true when no lastPage but the page is full', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: `Attr ${i}`,
      key: `attr_${i}`,
    }));
    const result = adaptAttributesEnvelope(rows, 1, 10);
    expect(result.has_more).toBe(true);
  });

  it('filters rows that are missing id/name/key', () => {
    const result = adaptAttributesEnvelope(
      {
        data: [
          { id: 1, name: 'Good', key: 'good' },
          { id: 2, name: 'Missing key' }, // no key
          { id: 3, key: 'no_name' }, // no name
          { name: 'no_id', key: 'no_id' }, // no id
        ],
      },
      1,
      10,
    );
    expect(result.attributes).toHaveLength(1);
    expect(result.attributes[0].name).toBe('Good');
  });

  it('returns an empty page for unrecognized shapes', () => {
    const result = adaptAttributesEnvelope({ unexpected: true }, 1, 10);
    expect(result.attributes).toEqual([]);
    expect(result.has_more).toBe(false);
  });
});
