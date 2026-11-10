// src/subscriberFilter/schema.test.ts
import {
  attributeKeysIn,
  FIELD_OPS,
  hasSegmentRule,
  MINUTES_PER_DAY,
  SubscriberFilterSchema,
} from './schema';

const wrap = (rule: Record<string, unknown>) => ({ op: 'or', value: [[rule]] });

describe('per-field operator matrix', () => {
  // The matrix is the whole point of this module: the API accepts these pairings and then
  // either matches nobody or (for segments) drops the rule and widens the audience.
  const rejected: Array<[string, Record<string, unknown>]> = [
    ['country with eq', { field: 'country', op: 'eq', value: 'India' }],
    ['state with gt', { field: 'state', op: 'gt', value: 'x' }],
    ['city with exists', { field: 'city', op: 'exists' }],
    ['device with eq', { field: 'device', op: 'eq', value: 'mobile' }],
    ['device_type with ne', { field: 'device_type', op: 'ne', value: 'chrome' }],
    ['segments with eq', { field: 'segments', op: 'eq', value: 'Sports Fans' }],
    ['segments with exists', { field: 'segments', op: 'exists' }],
    ['sent_count with in', { field: 'sent_count', op: 'in', value: [1, 2] }],
    ['ts_created with eq', { field: 'ts_created', op: 'eq', value: '2026-01-01' }],
    ['profile_id with eq', { field: 'profile_id', op: 'eq', value: 'u1' }],
  ];

  it.each(rejected)('rejects %s', (_label, rule) => {
    expect(SubscriberFilterSchema.safeParse(wrap(rule)).success).toBe(false);
  });

  const accepted: Array<[string, Record<string, unknown>]> = [
    ['country with in', { field: 'country', op: 'in', value: ['India'] }],
    ['country with nin', { field: 'country', op: 'nin', value: ['India'] }],
    ['segments with in', { field: 'segments', op: 'in', value: ['Sports Fans'] }],
    ['segments with all', { field: 'segments', op: 'all', value: [1, 2] }],
    ['segments with nin', { field: 'segments', op: 'nin', value: [3] }],
    ['sent_count with gte', { field: 'sent_count', op: 'gte', value: 20 }],
    ['ts_created with lt', { field: 'ts_created', op: 'lt', value: '2026-01-01' }],
    [
      'ts_last_click with ts_elapsed_lt',
      { field: 'ts_last_click', op: 'ts_elapsed_lt', value: 10080 },
    ],
    ['profile_id with in', { field: 'profile_id', op: 'in', value: ['u1'] }],
    ['attributes with exists', { field: 'attributes', op: 'exists', key: 'plan' }],
    ['attributes with eq', { field: 'attributes', op: 'eq', value: 'gold', key: 'plan' }],
  ];

  it.each(accepted)('accepts %s', (_label, rule) => {
    expect(SubscriberFilterSchema.safeParse(wrap(rule)).success).toBe(true);
  });

  it('names the supported operators in the error message', () => {
    const result = SubscriberFilterSchema.safeParse(
      wrap({ field: 'segments', op: 'eq', value: 'Sports Fans' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('in, all, nin');
    }
  });

  it('allows every op the matrix lists for its field', () => {
    for (const [field, ops] of Object.entries(FIELD_OPS)) {
      for (const op of ops) {
        const rule: Record<string, unknown> = { field, op };
        if (field === 'attributes') rule.key = 'plan';
        if (op === 'in' || op === 'nin' || op === 'all') {
          rule.value = field === 'device' ? ['mobile'] : field === 'device_type' ? ['chrome'] : [1];
        } else if (op === 'ts_elapsed_gt' || op === 'ts_elapsed_lt') {
          // Minutes, not seconds — 1440 is one day. See the ELAPSED_OPS comment in ./schema.
          rule.value = MINUTES_PER_DAY;
        } else if (op === 'dt_gt' || op === 'dt_lt') {
          rule.value = '2026-11-05';
        } else if (op !== 'exists' && op !== 'not_exists') {
          // ts_* fields compare against a date; everything else takes a scalar.
          rule.value = field.startsWith('ts_') ? '2026-11-05 09:00:00' : 1;
        }
        expect({
          field,
          op,
          ok: SubscriberFilterSchema.safeParse(wrap(rule)).success,
        }).toEqual({ field, op, ok: true });
      }
    }
  });
});

describe('the singular `segment` field is not accepted', () => {
  // It bypasses the API's segment scrubbing entirely, so it is the one spelling that can
  // defeat every other safeguard here.
  it('rejects field="segment"', () => {
    expect(
      SubscriberFilterSchema.safeParse(wrap({ field: 'segment', op: 'in', value: [1] })).success,
    ).toBe(false);
  });
});

describe('value shape rules', () => {
  it('rejects a scalar for an array op', () => {
    expect(
      SubscriberFilterSchema.safeParse(wrap({ field: 'country', op: 'in', value: 'India' }))
        .success,
    ).toBe(false);
  });

  it('rejects an array for a scalar op', () => {
    expect(
      SubscriberFilterSchema.safeParse(wrap({ field: 'sent_count', op: 'gt', value: [1] })).success,
    ).toBe(false);
  });

  it('requires a positive integer of minutes for ts_elapsed ops', () => {
    expect(
      SubscriberFilterSchema.safeParse(
        wrap({ field: 'ts_created', op: 'ts_elapsed_lt', value: '7 days' }),
      ).success,
    ).toBe(false);
    expect(
      SubscriberFilterSchema.safeParse(
        wrap({ field: 'ts_created', op: 'ts_elapsed_lt', value: -1 }),
      ).success,
    ).toBe(false);
    expect(
      SubscriberFilterSchema.safeParse(
        wrap({ field: 'ts_created', op: 'ts_elapsed_lt', value: 1.5 }),
      ).success,
    ).toBe(false);
  });

  // QA P0-1 on PR #287: the unit is minutes, and the delivery engine multiplies by 60000. A
  // seconds value is a valid integer, so nothing rejects it — it just targets 60x the window.
  // See the ELAPSED_OPS comment in ./schema for the four sources.
  describe('the ts_elapsed_* unit is minutes', () => {
    it('pins the days multiplier', () => {
      expect(MINUTES_PER_DAY).toBe(1440);
      expect(7 * MINUTES_PER_DAY).toBe(10080);
    });

    it('says minutes, not seconds, when it rejects a value', () => {
      const r = SubscriberFilterSchema.safeParse(
        wrap({ field: 'ts_created', op: 'ts_elapsed_lt', value: 0 }),
      );
      expect(r.success).toBe(false);
      if (!r.success) {
        const message = r.error.issues.map((i) => i.message).join(' ');
        expect(message).toMatch(/MINUTES/);
        expect(message).not.toMatch(/second/i);
        expect(message).toContain('10080');
      }
    });

    it('accepts seven days expressed in minutes', () => {
      expect(
        SubscriberFilterSchema.safeParse(
          wrap({ field: 'ts_created', op: 'ts_elapsed_lt', value: 7 * MINUTES_PER_DAY }),
        ).success,
      ).toBe(true);
    });
  });

  it('rejects a rule missing value when the op needs one', () => {
    expect(SubscriberFilterSchema.safeParse(wrap({ field: 'device', op: 'in' })).success).toBe(
      false,
    );
  });

  it('omits value for exists / not_exists and rejects one when present', () => {
    expect(
      SubscriberFilterSchema.safeParse(wrap({ field: 'attributes', op: 'exists', key: 'plan' }))
        .success,
    ).toBe(true);
    expect(
      SubscriberFilterSchema.safeParse(wrap({ field: 'attributes', op: 'not_exists', key: 'plan' }))
        .success,
    ).toBe(true);
    expect(
      SubscriberFilterSchema.safeParse(
        wrap({ field: 'attributes', op: 'exists', key: 'plan', value: 'gold' }),
      ).success,
    ).toBe(false);
  });
});

describe('common pattern examples', () => {
  it('accepts compound AND rules in one group (high engagement)', () => {
    expect(
      SubscriberFilterSchema.safeParse({
        op: 'or',
        value: [
          [
            { field: 'sent_count', op: 'gt', value: 20 },
            { field: 'click_count', op: 'gt', value: 2 },
          ],
        ],
      }).success,
    ).toBe(true);
  });

  /**
   * QA N4 on PR #287. The API accepts op="and", and delivery honours it, but the dashboard cannot
   * represent it: `AudienceFilterPreview` hardcodes "OR" between groups and never reads
   * `filter.op`, and `formatAudienceGroupFormData` writes no `op` at all on save. An AND filter
   * therefore reads as OR in the UI, and editing it there changes what it means. Refused rather
   * than offered, with a message naming the alternative.
   */
  it('rejects op="and" and explains what to do instead', () => {
    const result = SubscriberFilterSchema.safeParse({
      op: 'and',
      value: [
        [{ field: 'device', op: 'in', value: ['mobile'] }],
        [{ field: 'country', op: 'in', value: ['US'] }],
      ],
    });
    expect(result.success).toBe(false);
    const message = result.success ? '' : JSON.stringify(result.error.issues);
    expect(message).toContain('not supported');
    // Must point at the workaround, or the model just retries with the same shape.
    expect(message).toContain('one group');
  });

  it('still accepts multiple groups under the default op="or"', () => {
    expect(
      SubscriberFilterSchema.safeParse({
        value: [
          [{ field: 'device', op: 'in', value: ['mobile'] }],
          [{ field: 'country', op: 'in', value: ['US'] }],
        ],
      }).success,
    ).toBe(true);
  });
});

describe('closed value vocabularies', () => {
  it('rejects an unknown device', () => {
    const result = SubscriberFilterSchema.safeParse(
      wrap({ field: 'device', op: 'in', value: ['Mobile'] }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toContain('mobile');
  });

  it('rejects an unknown browser', () => {
    expect(
      SubscriberFilterSchema.safeParse(wrap({ field: 'device_type', op: 'in', value: ['Chrome'] }))
        .success,
    ).toBe(false);
  });

  it('does NOT constrain geo values, which are site-specific', () => {
    expect(
      SubscriberFilterSchema.safeParse(
        wrap({ field: 'country', op: 'in', value: ['Somewhere Made Up'] }),
      ).success,
    ).toBe(true);
  });
});

describe('key / field coupling', () => {
  it('requires key for attributes', () => {
    expect(
      SubscriberFilterSchema.safeParse(wrap({ field: 'attributes', op: 'eq', value: 'gold' }))
        .success,
    ).toBe(false);
  });

  it('rejects key on any other field', () => {
    expect(
      SubscriberFilterSchema.safeParse(
        wrap({ field: 'country', op: 'in', value: ['India'], key: 'plan' }),
      ).success,
    ).toBe(false);
  });
});

describe('helpers', () => {
  const filter = SubscriberFilterSchema.parse({
    value: [
      [
        { field: 'segments', op: 'in', value: ['Sports Fans'] },
        { field: 'attributes', op: 'eq', value: 'gold', key: 'plan' },
      ],
      [{ field: 'attributes', op: 'exists', key: 'city' }],
    ],
  });

  it('detects segment rules', () => {
    expect(hasSegmentRule(filter)).toBe(true);
    const noSegments = SubscriberFilterSchema.parse({
      op: 'or',
      value: [[{ field: 'device', op: 'in', value: ['mobile'] }]],
    });
    expect(hasSegmentRule(noSegments)).toBe(false);
  });

  it('collects distinct attribute keys', () => {
    expect(attributeKeysIn(filter).sort()).toEqual(['city', 'plan']);
  });
});

describe('structure limits', () => {
  it('rejects an empty filter', () => {
    expect(SubscriberFilterSchema.safeParse({ op: 'or', value: [] }).success).toBe(false);
  });

  it('rejects an empty group', () => {
    expect(SubscriberFilterSchema.safeParse({ op: 'or', value: [[]] }).success).toBe(false);
  });

  it('rejects more than 15 groups', () => {
    const tooMany = Array.from({ length: 16 }, () => [
      { field: 'device', op: 'in', value: ['mobile'] },
    ]);
    expect(SubscriberFilterSchema.safeParse({ op: 'or', value: tooMany }).success).toBe(false);
  });

  it('rejects more than 50 rules in a single group', () => {
    const tooMany = Array.from({ length: 51 }, () => ({
      field: 'device' as const,
      op: 'in' as const,
      value: ['mobile'],
    }));
    expect(SubscriberFilterSchema.safeParse({ op: 'or', value: [tooMany] }).success).toBe(false);
  });

  it('defaults op to "or"', () => {
    const parsed = SubscriberFilterSchema.parse({
      value: [[{ field: 'device', op: 'in', value: ['mobile'] }]],
    });
    expect(parsed.op).toBe('or');
  });
});

describe('API-parity validation (audited against the Adonis validators)', () => {
  describe('attribute key', () => {
    it('rejects a key that could not have been created', () => {
      // Attribute creation enforces ^[A-Za-z][A-Za-z0-9_-]*$, so a leading digit or a dot
      // can never name a real attribute.
      for (const key of ['9lives', 'has.dot', 'has space', 'has/slash']) {
        expect(
          SubscriberFilterSchema.safeParse(wrap({ field: 'attributes', op: 'exists', key }))
            .success,
        ).toBe(false);
      }
    });

    it('rejects a key over the 64-char cap', () => {
      expect(
        SubscriberFilterSchema.safeParse(
          wrap({ field: 'attributes', op: 'exists', key: `a${'b'.repeat(64)}` }),
        ).success,
      ).toBe(false);
    });

    it('accepts valid keys', () => {
      for (const key of ['plan', 'loyalty_tier', 'a-b', 'P1']) {
        expect(
          SubscriberFilterSchema.safeParse(wrap({ field: 'attributes', op: 'exists', key }))
            .success,
        ).toBe(true);
      }
    });
  });

  describe('absolute date comparisons on ts_* fields', () => {
    it('accepts the API datetime format and ISO 8601', () => {
      for (const value of [
        '2026-11-05 09:00:00',
        '2026-11-05',
        '2026-11-05T09:00:00Z',
        '2026-11-05 9:00 AM',
      ]) {
        expect(
          SubscriberFilterSchema.safeParse(wrap({ field: 'ts_created', op: 'lt', value })).success,
        ).toBe(true);
      }
    });

    it('rejects a bare number or prose where a date is required', () => {
      for (const value of [1, 10080, 'last week', 'yesterday']) {
        expect(
          SubscriberFilterSchema.safeParse(wrap({ field: 'ts_created', op: 'gt', value })).success,
        ).toBe(false);
      }
    });

    it('points at ts_elapsed_* in the error', () => {
      const r = SubscriberFilterSchema.safeParse(
        wrap({ field: 'ts_created', op: 'lt', value: 10080 }),
      );
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toMatch(/ts_elapsed_lt/);
    });
  });

  describe('dt_gt / dt_lt require ISO dates', () => {
    it('accepts ISO', () => {
      expect(
        SubscriberFilterSchema.safeParse(
          wrap({ field: 'attributes', key: 'signup', op: 'dt_gt', value: '2026-11-05T00:00:00Z' }),
        ).success,
      ).toBe(true);
    });

    it('rejects non-ISO', () => {
      for (const value of ['05/11/2026', 'next monday', 12345]) {
        expect(
          SubscriberFilterSchema.safeParse(
            wrap({ field: 'attributes', key: 'signup', op: 'dt_lt', value }),
          ).success,
        ).toBe(false);
      }
    });
  });
});

// =============================================================================
// filter `timezone` — refuse it rather than let it do nothing
// =============================================================================

describe('SubscriberFilterSchema — timezone', () => {
  const withTz = (tz: string, value: unknown) =>
    SubscriberFilterSchema.safeParse({ op: 'or', value, timezone: tz });

  it('accepts a timezone alongside a naive date value', () => {
    const result = withTz('Asia/Kolkata', [
      [{ field: 'ts_created', op: 'gt', value: '2026-01-01 00:00:00' }],
    ]);
    expect(result.success).toBe(true);
  });

  /**
   * Validation used to ask only whether SOME date rule held a string, so a filter whose values
   * were all 12-hour, all fractional-second, all date-only or all explicitly offset passed,
   * converted nothing and reported nothing (review of PR #287). The first two are forms the
   * schema advertises, so they convert; the last two cannot, and are refused with a message
   * rather than accepted silently.
   */
  it('accepts the 12-hour and fractional-second forms, which do convert', () => {
    expect(
      withTz('Asia/Kolkata', [[{ field: 'ts_created', op: 'gt', value: '2026-01-01 9:00 AM' }]])
        .success,
    ).toBe(true);
    expect(
      withTz('Asia/Kolkata', [
        [{ field: 'ts_created', op: 'gt', value: '2026-01-01T09:00:00.000' }],
      ]).success,
    ).toBe(true);
  });

  /**
   * A date with no time of day stays valid on its own — it is only a timezone that cannot apply
   * to it, since the time of day is what a zone shifts. Deliberately NOT converted at 00:00, which
   * would invent precision the caller never gave. The message must name the fix and must not read
   * as "there is no date here", because there plainly is one.
   */
  it('refuses a timezone on a date with no time of day, and says what to do', () => {
    const result = withTz('Asia/Kolkata', [
      [{ field: 'ts_created', op: 'gt', value: '2026-01-01' }],
    ]);
    expect(result.success).toBe(false);
    const message = result.success ? '' : JSON.stringify(result.error.issues);
    expect(message).toContain('no time of day');
    expect(message).toContain('00:00:00');
    expect(message).not.toContain('has no date value');
  });

  it('still accepts a date-only value when no timezone is set', () => {
    const result = SubscriberFilterSchema.safeParse({
      op: 'or',
      value: [[{ field: 'ts_created', op: 'gt', value: '2026-01-01' }]],
    });
    expect(result.success).toBe(true);
  });

  it('refuses a timezone when every date value already states its own offset', () => {
    const result = withTz('Asia/Kolkata', [
      [{ field: 'ts_created', op: 'gt', value: '2026-01-01T00:00:00Z' }],
    ]);
    expect(result.success).toBe(false);
    const message = result.success ? '' : JSON.stringify(result.error.issues);
    expect(message).toContain('already states its own offset');
  });

  it('still refuses a timezone with no date value at all', () => {
    const result = withTz('Asia/Kolkata', [
      [{ field: 'ts_elapsed_lt', op: 'ts_elapsed_lt', value: 10080 }],
    ]);
    expect(result.success).toBe(false);
  });

  it('refuses the sign-inverted Etc/GMT±N zones', () => {
    const result = withTz('Etc/GMT+5', [
      [{ field: 'ts_created', op: 'gt', value: '2026-01-01 00:00:00' }],
    ]);
    expect(result.success).toBe(false);
    expect(result.success ? '' : JSON.stringify(result.error.issues)).toContain('BEHIND');
  });
});
