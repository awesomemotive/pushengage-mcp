// src/subscriberFilter/dates.test.ts
import { convertFilterDatesToUtc } from './dates';
import { SubscriberFilterSchema } from './schema';

const parse = (f: unknown) => SubscriberFilterSchema.parse(f);

describe('convertFilterDatesToUtc', () => {
  it('converts a naive ts_created date from the given zone to UTC', () => {
    const { filter, conversions } = convertFilterDatesToUtc(
      parse({
        timezone: 'Asia/Kolkata',
        value: [[{ field: 'ts_created', op: 'gt', value: '2026-01-01 00:00:00' }]],
      }),
    );
    // +05:30 means local midnight is 18:30 the previous day in UTC.
    expect(filter.value[0][0].value).toBe('2025-12-31 18:30:00');
    expect(conversions).toHaveLength(1);
    expect(conversions[0]).toMatchObject({
      field: 'ts_created',
      op: 'gt',
      requested: '2026-01-01 00:00:00',
      requested_timezone: 'Asia/Kolkata',
      requested_utc_offset: '+05:30',
      send_as_utc: '2025-12-31 18:30:00',
    });
  });

  it('strips the MCP-only timezone key from the outgoing filter', () => {
    // The API's subscriberFilterSchema has no `timezone`, and stripUnknown would discard it
    // silently — so it must not be sent at all.
    const { filter } = convertFilterDatesToUtc(
      parse({
        timezone: 'UTC',
        value: [[{ field: 'ts_created', op: 'gt', value: '2026-01-01 00:00:00' }]],
      }),
    );
    expect(Object.keys(filter).sort()).toEqual(['op', 'value']);
  });

  it('leaves everything alone when no timezone is given', () => {
    const input = parse({
      value: [[{ field: 'ts_created', op: 'gt', value: '2026-01-01 00:00:00' }]],
    });
    const { filter, conversions } = convertFilterDatesToUtc(input);
    expect(filter.value[0][0].value).toBe('2026-01-01 00:00:00');
    expect(conversions).toEqual([]);
  });

  it('honours a value that already carries an explicit offset', () => {
    // Paired with a naive value, because a filter whose dates ALL state their own offset has
    // nothing for `timezone` to do and the schema now rejects it outright.
    const { filter, conversions } = convertFilterDatesToUtc(
      parse({
        timezone: 'Asia/Kolkata',
        value: [
          [
            { field: 'ts_created', op: 'gt', value: '2026-01-01T00:00:00Z' },
            { field: 'ts_last_sent', op: 'lt', value: '2026-02-01 00:00:00' },
          ],
        ],
      }),
    );
    expect(filter.value[0][0].value).toBe('2026-01-01T00:00:00Z');
    expect(filter.value[0][1].value).toBe('2026-01-31 18:30:00');
    expect(conversions).toHaveLength(1);
    expect(conversions[0].field).toBe('ts_last_sent');
  });

  it('converts dt_gt / dt_lt on attributes', () => {
    const { filter, conversions } = convertFilterDatesToUtc(
      parse({
        timezone: 'Asia/Kolkata',
        value: [
          [{ field: 'attributes', key: 'renews', op: 'dt_gt', value: '2026-01-01 00:00:00' }],
        ],
      }),
    );
    expect(filter.value[0][0].value).toBe('2025-12-31 18:30:00');
    expect(conversions[0].key).toBe('renews');
  });

  it('does NOT touch ts_elapsed_* durations', () => {
    const { filter, conversions } = convertFilterDatesToUtc(
      parse({
        timezone: 'Asia/Kolkata',
        value: [
          [
            { field: 'ts_created', op: 'ts_elapsed_lt', value: 10080 },
            { field: 'ts_last_click', op: 'gt', value: '2026-01-01 00:00:00' },
          ],
        ],
      }),
    );
    expect(filter.value[0][0].value).toBe(10080);
    expect(conversions).toHaveLength(1);
    expect(conversions[0].field).toBe('ts_last_click');
  });

  it('leaves non-date rules untouched', () => {
    const { filter, conversions } = convertFilterDatesToUtc(
      parse({
        timezone: 'Asia/Kolkata',
        value: [
          [
            { field: 'segments', op: 'in', value: [12] },
            { field: 'ts_created', op: 'lt', value: '2026-01-01 00:00:00' },
          ],
        ],
      }),
    );
    expect(filter.value[0][0].value).toEqual([12]);
    expect(conversions).toHaveLength(1);
  });

  // Deliberate: a date with no time of day is left exactly as given rather than being assigned a
  // midnight to shift, because guessing a time of day invents precision the caller never gave.
  // The schema refuses a filter whose ONLY date value is one of these, so the caller is told the
  // zone cannot apply instead of finding out from the audience.
  it('leaves a date-only value alone rather than inventing a time of day', () => {
    const { filter, conversions } = convertFilterDatesToUtc(
      parse({
        timezone: 'Asia/Kolkata',
        value: [
          [
            { field: 'ts_created', op: 'gt', value: '2026-01-01' },
            { field: 'ts_last_sent', op: 'lt', value: '2026-02-01 00:00:00' },
          ],
        ],
      }),
    );
    expect(filter.value[0][0].value).toBe('2026-01-01');
    expect(conversions).toHaveLength(1);
    expect(conversions[0].field).toBe('ts_last_sent');
  });

  it('converts the 12-hour and fractional-second forms the schema accepts', () => {
    const twelveHour = convertFilterDatesToUtc(
      parse({
        timezone: 'Asia/Kolkata',
        value: [[{ field: 'ts_created', op: 'gt', value: '2026-01-01 9:00 AM' }]],
      }),
    );
    expect(twelveHour.filter.value[0][0].value).toBe('2026-01-01 03:30:00');

    const fractional = convertFilterDatesToUtc(
      parse({
        timezone: 'Asia/Kolkata',
        value: [[{ field: 'ts_created', op: 'gt', value: '2026-01-01T09:00:00.000' }]],
      }),
    );
    expect(fractional.filter.value[0][0].value).toBe('2026-01-01 03:30:00');
  });

  it('converts across DST on the caller side', () => {
    const summer = convertFilterDatesToUtc(
      parse({
        timezone: 'America/New_York',
        value: [[{ field: 'ts_created', op: 'gt', value: '2027-07-15 12:00:00' }]],
      }),
    );
    const winter = convertFilterDatesToUtc(
      parse({
        timezone: 'America/New_York',
        value: [[{ field: 'ts_created', op: 'gt', value: '2027-01-15 12:00:00' }]],
      }),
    );
    expect(summer.filter.value[0][0].value).toBe('2027-07-15 16:00:00'); // EDT -04:00
    expect(winter.filter.value[0][0].value).toBe('2027-01-15 17:00:00'); // EST -05:00
  });
});

describe('filter timezone validation', () => {
  it('rejects an ambiguous abbreviation', () => {
    expect(
      SubscriberFilterSchema.safeParse({
        timezone: 'IST',
        value: [[{ field: 'ts_created', op: 'gt', value: '2026-01-01 00:00:00' }]],
      }).success,
    ).toBe(false);
  });

  it('rejects a timezone with no date value to apply it to', () => {
    const r = SubscriberFilterSchema.safeParse({
      timezone: 'Asia/Kolkata',
      value: [[{ field: 'ts_created', op: 'ts_elapsed_lt', value: 10080 }]],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/ts_elapsed/);
  });

  it('accepts a valid zone with a date value', () => {
    expect(
      SubscriberFilterSchema.safeParse({
        timezone: 'Asia/Kolkata',
        value: [[{ field: 'ts_created', op: 'gt', value: '2026-01-01 00:00:00' }]],
      }).success,
    ).toBe(true);
  });
});
