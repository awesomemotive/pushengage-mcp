// src/audienceGroups/schema.test.ts
import {
  CreateAudienceGroupInputSchema,
  ListAudienceGroupsInputSchema,
  toCreateAudienceGroupApiBody,
} from './schema';

describe('ListAudienceGroupsInputSchema', () => {
  it('applies defaults (limit=10, page=1)', () => {
    const result = ListAudienceGroupsInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.page).toBe(1);
    }
  });

  it('accepts limit up to 100', () => {
    expect(ListAudienceGroupsInputSchema.safeParse({ limit: 100 }).success).toBe(true);
  });

  it('rejects limit > 100', () => {
    expect(ListAudienceGroupsInputSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('rejects page < 1', () => {
    expect(ListAudienceGroupsInputSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it('accepts name_contains', () => {
    expect(ListAudienceGroupsInputSchema.safeParse({ name_contains: 'VIP' }).success).toBe(true);
  });
});

describe('CreateAudienceGroupInputSchema', () => {
  const validFilter = {
    op: 'or' as const,
    value: [[{ field: 'device' as const, op: 'in' as const, value: ['mobile'] }]],
  };

  it('accepts a minimal create', () => {
    const result = CreateAudienceGroupInputSchema.safeParse({
      name: 'Mobile subscribers',
      filter: validFilter,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    expect(
      CreateAudienceGroupInputSchema.safeParse({ name: '  ', filter: validFilter }).success,
    ).toBe(false);
  });

  it('rejects name > 150 chars', () => {
    expect(
      CreateAudienceGroupInputSchema.safeParse({
        name: 'x'.repeat(151),
        filter: validFilter,
      }).success,
    ).toBe(false);
  });

  it('rejects description > 256 chars', () => {
    expect(
      CreateAudienceGroupInputSchema.safeParse({
        name: 'X',
        description: 'y'.repeat(257),
        filter: validFilter,
      }).success,
    ).toBe(false);
  });

  it('rejects missing filter', () => {
    expect(CreateAudienceGroupInputSchema.safeParse({ name: 'X' }).success).toBe(false);
  });
});

describe('toCreateAudienceGroupApiBody', () => {
  const validFilter = {
    op: 'or' as const,
    value: [[{ field: 'device' as const, op: 'in' as const, value: ['mobile'] }]],
  };

  it('forwards required fields verbatim', () => {
    const body = toCreateAudienceGroupApiBody({ name: 'Mobile', filter: validFilter });
    expect(body).toEqual({ name: 'Mobile', filter: validFilter });
  });

  it('includes description when provided', () => {
    const body = toCreateAudienceGroupApiBody({
      name: 'Mobile',
      description: 'mobile-only subs',
      filter: validFilter,
    });
    expect(body.description).toBe('mobile-only subs');
  });

  it('omits description when not provided', () => {
    const body = toCreateAudienceGroupApiBody({ name: 'Mobile', filter: validFilter });
    expect(body.description).toBeUndefined();
  });
});
