// src/audienceGroups/schema.test.ts
import {
  CreateAudienceGroupInputSchema,
  ListAudienceGroupsInputSchema,
  SubscriberFilterSchema,
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

describe('SubscriberFilterSchema rule semantics', () => {
  it('accepts a minimal device-in filter', () => {
    const result = SubscriberFilterSchema.safeParse({
      op: 'or',
      value: [[{ field: 'device', op: 'in', value: ['mobile'] }]],
    });
    expect(result.success).toBe(true);
  });

  it('applies op="or" default when omitted', () => {
    const result = SubscriberFilterSchema.safeParse({
      value: [[{ field: 'device', op: 'in', value: ['mobile'] }]],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.op).toBe('or');
  });

  it('rejects empty value array', () => {
    expect(SubscriberFilterSchema.safeParse({ op: 'or', value: [] }).success).toBe(false);
  });

  it('rejects empty inner group', () => {
    expect(SubscriberFilterSchema.safeParse({ op: 'or', value: [[]] }).success).toBe(false);
  });

  it('rejects > 15 groups', () => {
    const tooMany = Array.from({ length: 16 }, () => [
      { field: 'device', op: 'in', value: ['mobile'] },
    ]);
    expect(SubscriberFilterSchema.safeParse({ op: 'or', value: tooMany }).success).toBe(false);
  });

  it('rejects > 50 rules in a single group', () => {
    const tooMany = Array.from({ length: 51 }, () => ({
      field: 'device' as const,
      op: 'in' as const,
      value: ['mobile'],
    }));
    expect(SubscriberFilterSchema.safeParse({ op: 'or', value: [tooMany] }).success).toBe(false);
  });

  describe('rule.value-vs-op coupling', () => {
    it('rejects a rule missing value when op needs one', () => {
      const result = SubscriberFilterSchema.safeParse({
        op: 'or',
        value: [[{ field: 'device', op: 'in' }]],
      });
      expect(result.success).toBe(false);
    });

    it('accepts exists with no value', () => {
      const result = SubscriberFilterSchema.safeParse({
        op: 'or',
        value: [[{ field: 'attributes', op: 'exists', key: 'plan' }]],
      });
      expect(result.success).toBe(true);
    });

    it('accepts not_exists with no value', () => {
      const result = SubscriberFilterSchema.safeParse({
        op: 'or',
        value: [[{ field: 'attributes', op: 'not_exists', key: 'plan' }]],
      });
      expect(result.success).toBe(true);
    });

    it('rejects exists with a value', () => {
      const result = SubscriberFilterSchema.safeParse({
        op: 'or',
        value: [[{ field: 'attributes', op: 'exists', key: 'plan', value: 'gold' }]],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('rule.key-vs-field coupling', () => {
    it('requires key when field="attributes"', () => {
      const result = SubscriberFilterSchema.safeParse({
        op: 'or',
        value: [[{ field: 'attributes', op: 'eq', value: 'gold' }]],
      });
      expect(result.success).toBe(false);
    });

    it('accepts key on a non-attributes field (ignored by API)', () => {
      const result = SubscriberFilterSchema.safeParse({
        op: 'or',
        value: [[{ field: 'device', op: 'in', value: ['mobile'], key: 'whatever' }]],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('common pattern examples', () => {
    it('accepts ts_elapsed_lt with seconds value (subscribed in last 7 days)', () => {
      const result = SubscriberFilterSchema.safeParse({
        op: 'or',
        value: [[{ field: 'ts_created', op: 'ts_elapsed_lt', value: 7 * 24 * 3600 }]],
      });
      expect(result.success).toBe(true);
    });

    it('accepts compound AND rules in one group (high engagement)', () => {
      const result = SubscriberFilterSchema.safeParse({
        op: 'or',
        value: [
          [
            { field: 'sent_count', op: 'gt', value: 20 },
            { field: 'click_count', op: 'gt', value: 2 },
          ],
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts multiple groups with op="and" (must match all groups)', () => {
      const result = SubscriberFilterSchema.safeParse({
        op: 'and',
        value: [
          [{ field: 'device', op: 'in', value: ['mobile'] }],
          [{ field: 'country', op: 'in', value: ['US'] }],
        ],
      });
      expect(result.success).toBe(true);
    });
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
