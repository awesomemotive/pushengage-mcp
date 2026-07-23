// src/audienceGroups/api.test.ts
import { __testing__ } from './api';

const { adaptAudienceGroupsEnvelope } = __testing__;

describe('adaptAudienceGroupsEnvelope', () => {
  it('handles a paginated { data, total, perPage, page, lastPage } envelope', () => {
    const result = adaptAudienceGroupsEnvelope(
      {
        data: [
          { id: 1, name: 'Mobile subscribers', description: 'mobile' },
          { id: 2, name: 'Engaged', filter: { op: 'or', value: [[{}]] } },
        ],
        total: 12,
        perPage: 10,
        page: 1,
        lastPage: 2,
      },
      1,
      10,
    );
    expect(result.audience_groups).toHaveLength(2);
    expect(result.audience_groups[0]).toEqual({
      id: 1,
      name: 'Mobile subscribers',
      description: 'mobile',
    });
    expect(result.total).toBe(12);
    expect(result.last_page).toBe(2);
    expect(result.has_more).toBe(true);
  });

  it('reports has_more=false on the last page', () => {
    const result = adaptAudienceGroupsEnvelope(
      { data: [{ id: 1, name: 'Only' }], total: 1, page: 1, lastPage: 1 },
      1,
      10,
    );
    expect(result.has_more).toBe(false);
  });

  it('handles a bare array fallback', () => {
    const result = adaptAudienceGroupsEnvelope(
      [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
      1,
      10,
    );
    expect(result.audience_groups).toHaveLength(2);
    expect(result.has_more).toBe(false);
  });

  it('infers has_more=true when no lastPage but the page is full', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `G${i}` }));
    const result = adaptAudienceGroupsEnvelope(rows, 1, 10);
    expect(result.has_more).toBe(true);
  });

  it('filters rows without id/name', () => {
    const result = adaptAudienceGroupsEnvelope(
      {
        data: [{ id: 1, name: 'Good' }, { foo: 'bar' }, { id: 'not-a-number', name: 'Bad' }],
      },
      1,
      10,
    );
    expect(result.audience_groups).toHaveLength(1);
    expect(result.audience_groups[0].name).toBe('Good');
  });

  it('returns an empty page for unrecognized shapes', () => {
    const result = adaptAudienceGroupsEnvelope({ unexpected: true }, 1, 10);
    expect(result.audience_groups).toEqual([]);
    expect(result.has_more).toBe(false);
  });
});
