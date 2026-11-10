// src/audienceFilterValues/schema.test.ts
import { ListAudienceFilterValuesInputSchema, toAudienceFilterValuesQuery } from './schema';

describe('ListAudienceFilterValuesInputSchema', () => {
  it('defaults to country with a capped limit', () => {
    const parsed = ListAudienceFilterValuesInputSchema.parse({});
    expect(parsed.fields).toEqual(['country']);
    expect(parsed.limit).toBe(50);
  });

  it('accepts every custom-audience field whose values it can list', () => {
    const parsed = ListAudienceFilterValuesInputSchema.parse({
      fields: ['country', 'state', 'city', 'device', 'device_type'],
    });
    expect(parsed.fields).toHaveLength(5);
  });

  it('rejects platform, which the endpoint accepts but is not a filter field', () => {
    expect(ListAudienceFilterValuesInputSchema.safeParse({ fields: ['platform'] }).success).toBe(
      false,
    );
  });

  it('rejects fields whose values come from a different tool', () => {
    // segments -> pushengage_list_segments, attributes -> pushengage_list_attributes.
    expect(ListAudienceFilterValuesInputSchema.safeParse({ fields: ['segments'] }).success).toBe(
      false,
    );
    expect(ListAudienceFilterValuesInputSchema.safeParse({ fields: ['attributes'] }).success).toBe(
      false,
    );
  });

  it('rejects an empty fields array', () => {
    expect(ListAudienceFilterValuesInputSchema.safeParse({ fields: [] }).success).toBe(false);
  });

  it('enforces the limit bounds', () => {
    expect(ListAudienceFilterValuesInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(ListAudienceFilterValuesInputSchema.safeParse({ limit: 501 }).success).toBe(false);
    expect(ListAudienceFilterValuesInputSchema.safeParse({ limit: 500 }).success).toBe(true);
  });

  it('trims value_contains and rejects a blank one', () => {
    expect(
      ListAudienceFilterValuesInputSchema.parse({ value_contains: '  pune ' }).value_contains,
    ).toBe('pune');
    expect(ListAudienceFilterValuesInputSchema.safeParse({ value_contains: '   ' }).success).toBe(
      false,
    );
  });
});

describe('toAudienceFilterValuesQuery', () => {
  it("maps `fields` onto the API's comma-separated `type_data`", () => {
    const input = ListAudienceFilterValuesInputSchema.parse({ fields: ['country', 'city'] });
    expect(toAudienceFilterValuesQuery(input)).toEqual({ type_data: 'country,city' });
  });
});
