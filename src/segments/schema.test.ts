// src/segments/schema.test.ts
import {
  CreateSegmentInputSchema,
  ListSegmentsInputSchema,
  toCreateSegmentApiBody,
} from './schema';

describe('ListSegmentsInputSchema', () => {
  it('applies defaults (limit=10, page=1)', () => {
    const result = ListSegmentsInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.page).toBe(1);
    }
  });

  it('accepts an explicit limit up to 100', () => {
    const result = ListSegmentsInputSchema.safeParse({ limit: 100 });
    expect(result.success).toBe(true);
  });

  it('rejects limit > 100', () => {
    const result = ListSegmentsInputSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it('rejects limit < 1', () => {
    const result = ListSegmentsInputSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects page < 1', () => {
    const result = ListSegmentsInputSchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it('accepts name_contains filter', () => {
    const result = ListSegmentsInputSchema.safeParse({ name_contains: 'premium' });
    expect(result.success).toBe(true);
  });

  it('rejects empty name_contains', () => {
    const result = ListSegmentsInputSchema.safeParse({ name_contains: '   ' });
    expect(result.success).toBe(false);
  });
});

describe('CreateSegmentInputSchema', () => {
  it('accepts a minimal segment (name only)', () => {
    const result = CreateSegmentInputSchema.safeParse({ segment_name: 'VIP' });
    expect(result.success).toBe(true);
    if (result.success) {
      // add_segment_on_page_load should default to false.
      expect(result.data.add_segment_on_page_load).toBe(false);
    }
  });

  it('rejects empty segment_name', () => {
    const result = CreateSegmentInputSchema.safeParse({ segment_name: '  ' });
    expect(result.success).toBe(false);
  });

  it('rejects segment_name > 150 chars', () => {
    const result = CreateSegmentInputSchema.safeParse({ segment_name: 'x'.repeat(151) });
    expect(result.success).toBe(false);
  });

  it('accepts include + exclude rules', () => {
    const result = CreateSegmentInputSchema.safeParse({
      segment_name: 'Blog readers',
      segment_criteria: {
        include: [{ rule: 'contains', value: '/blog/' }],
        exclude: [{ rule: 'exact', value: 'https://example.com/blog/admin' }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects segment_criteria with neither include nor exclude', () => {
    const result = CreateSegmentInputSchema.safeParse({
      segment_name: 'Empty',
      segment_criteria: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown rule type', () => {
    const result = CreateSegmentInputSchema.safeParse({
      segment_name: 'Bad',
      segment_criteria: {
        include: [{ rule: 'regex', value: '/.*/' }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts an empty include array', () => {
    const result = CreateSegmentInputSchema.safeParse({
      segment_name: 'Empty include',
      segment_criteria: { include: [] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts include and exclude both as empty arrays', () => {
    const result = CreateSegmentInputSchema.safeParse({
      segment_name: 'Empty both',
      segment_criteria: { include: [], exclude: [] },
    });
    expect(result.success).toBe(true);
  });
});

describe('toCreateSegmentApiBody', () => {
  it('maps minimal input with add_segment_on_page_load=0', () => {
    const body = toCreateSegmentApiBody({
      segment_name: 'VIP',
      add_segment_on_page_load: false,
    });
    expect(body).toEqual({
      segment_name: 'VIP',
      add_segment_on_page_load: 0,
    });
  });

  it('maps add_segment_on_page_load=true to 1', () => {
    const body = toCreateSegmentApiBody({
      segment_name: 'VIP',
      add_segment_on_page_load: true,
    });
    expect(body.add_segment_on_page_load).toBe(1);
  });

  it('forwards include/exclude rules unchanged', () => {
    const body = toCreateSegmentApiBody({
      segment_name: 'Blog readers',
      add_segment_on_page_load: true,
      segment_criteria: {
        include: [{ rule: 'contains', value: '/blog/' }],
        exclude: [{ rule: 'exact', value: 'https://example.com/blog/admin' }],
      },
    });
    expect(body.segment_criteria).toEqual({
      include: [{ rule: 'contains', value: '/blog/' }],
      exclude: [{ rule: 'exact', value: 'https://example.com/blog/admin' }],
    });
  });

  it('omits segment_criteria entirely when not provided', () => {
    const body = toCreateSegmentApiBody({
      segment_name: 'Plain',
      add_segment_on_page_load: false,
    });
    expect(body.segment_criteria).toBeUndefined();
  });
});
