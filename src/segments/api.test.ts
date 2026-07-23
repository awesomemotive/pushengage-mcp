// src/segments/api.test.ts
import { __testing__ } from './api';

const { adaptSegmentsEnvelope } = __testing__;

describe('adaptSegmentsEnvelope', () => {
  it('handles a paginated { data, total, perPage, page, lastPage } envelope', () => {
    const result = adaptSegmentsEnvelope(
      {
        data: [
          { segment_id: 1, segment_name: 'VIP', subscribers: 200 },
          { segment_id: 2, segment_name: 'Free', subscribers: 50 },
        ],
        total: 12,
        perPage: 10,
        page: 1,
        lastPage: 2,
      },
      1,
      10,
    );
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toEqual({
      segment_id: 1,
      segment_name: 'VIP',
      subscribers: 200,
    });
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.total).toBe(12);
    expect(result.last_page).toBe(2);
    expect(result.has_more).toBe(true);
  });

  it('reports has_more=false when on the last page', () => {
    const result = adaptSegmentsEnvelope(
      { data: [{ segment_id: 1, segment_name: 'Only' }], total: 1, page: 1, lastPage: 1 },
      1,
      10,
    );
    expect(result.has_more).toBe(false);
  });

  it('handles a bare array (no envelope)', () => {
    const result = adaptSegmentsEnvelope(
      [
        { segment_id: 1, segment_name: 'A' },
        { segment_id: 2, segment_name: 'B' },
      ],
      1,
      10,
    );
    expect(result.segments).toHaveLength(2);
    expect(result.has_more).toBe(false); // 2 < 10
  });

  it('infers has_more=true when no lastPage but page is full', () => {
    const result = adaptSegmentsEnvelope(
      Array.from({ length: 10 }, (_, i) => ({ segment_id: i + 1, segment_name: `S${i}` })),
      1,
      10,
    );
    expect(result.has_more).toBe(true);
  });

  it('drops rows that do not have segment_id/segment_name', () => {
    const result = adaptSegmentsEnvelope(
      {
        data: [
          { segment_id: 1, segment_name: 'Good' },
          { foo: 'bar' },
          { segment_id: 'not-a-number', segment_name: 'Bad' },
        ],
      },
      1,
      10,
    );
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].segment_name).toBe('Good');
  });

  it('returns an empty page for unrecognized shapes', () => {
    const result = adaptSegmentsEnvelope({ unexpected: true }, 1, 10);
    expect(result.segments).toEqual([]);
    expect(result.has_more).toBe(false);
  });
});
