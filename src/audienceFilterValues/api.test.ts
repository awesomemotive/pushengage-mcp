// src/audienceFilterValues/api.test.ts
import { __testing__ } from './api';

const { adaptAudienceFilterValuesEnvelope } = __testing__;

describe('adaptAudienceFilterValuesEnvelope', () => {
  it('turns the value→count map into a sorted array', () => {
    const out = adaptAudienceFilterValuesEnvelope(
      { country: { India: 120, 'United States': 4500, Canada: 300 } },
      ['country'],
      50,
    );
    expect(out.fields.country.values).toEqual([
      { value: 'United States', subscribers: 4500 },
      { value: 'Canada', subscribers: 300 },
      { value: 'India', subscribers: 120 },
    ]);
    expect(out.fields.country.total_values).toBe(3);
    expect(out.fields.country.truncated).toBe(false);
  });

  it('breaks count ties by name so output is stable', () => {
    const out = adaptAudienceFilterValuesEnvelope(
      { city: { Pune: 10, Ahmedabad: 10 } },
      ['city'],
      50,
    );
    expect(out.fields.city.values.map((v) => v.value)).toEqual(['Ahmedabad', 'Pune']);
  });

  it('caps at limit and flags truncation, keeping the highest-reach values', () => {
    const out = adaptAudienceFilterValuesEnvelope({ city: { A: 1, B: 50, C: 20 } }, ['city'], 2);
    expect(out.fields.city.values).toEqual([
      { value: 'B', subscribers: 50 },
      { value: 'C', subscribers: 20 },
    ]);
    expect(out.fields.city.total_values).toBe(3);
    expect(out.fields.city.truncated).toBe(true);
  });

  it('applies value_contains case-insensitively before the cap', () => {
    const out = adaptAudienceFilterValuesEnvelope(
      { city: { Pune: 10, Mumbai: 90, 'New Pune': 5 } },
      ['city'],
      50,
      'pune',
    );
    expect(out.fields.city.values.map((v) => v.value)).toEqual(['Pune', 'New Pune']);
    expect(out.fields.city.total_values).toBe(2);
  });

  it('returns an empty result for a requested field the API omitted', () => {
    const out = adaptAudienceFilterValuesEnvelope(
      { country: { India: 1 } },
      ['country', 'state'],
      50,
    );
    expect(out.fields.state).toEqual({ values: [], total_values: 0, truncated: false });
  });

  it('drops blank keys (unresolved geo), which are not selectable in the dashboard either', () => {
    const out = adaptAudienceFilterValuesEnvelope({ state: { '': 900, Goa: 3 } }, ['state'], 50);
    expect(out.fields.state.values).toEqual([{ value: 'Goa', subscribers: 3 }]);
  });

  it('coerces string counts', () => {
    const out = adaptAudienceFilterValuesEnvelope({ device: { mobile: '42' } }, ['device'], 50);
    expect(out.fields.device.values).toEqual([{ value: 'mobile', subscribers: 42 }]);
  });

  it('treats an unusable count as zero rather than dropping the value', () => {
    const out = adaptAudienceFilterValuesEnvelope({ device: { desktop: null } }, ['device'], 50);
    expect(out.fields.device.values).toEqual([{ value: 'desktop', subscribers: 0 }]);
  });

  it('survives an unexpected shape', () => {
    expect(adaptAudienceFilterValuesEnvelope(null, ['country'], 50).fields.country.values).toEqual(
      [],
    );
    expect(
      adaptAudienceFilterValuesEnvelope([1, 2], ['country'], 50).fields.country.values,
    ).toEqual([]);
    expect(
      adaptAudienceFilterValuesEnvelope({ country: 'nope' }, ['country'], 50).fields.country.values,
    ).toEqual([]);
  });

  it('handles multiple requested fields independently', () => {
    const out = adaptAudienceFilterValuesEnvelope(
      { country: { India: 5 }, device: { mobile: 9, desktop: 1 } },
      ['country', 'device'],
      50,
    );
    expect(Object.keys(out.fields).sort()).toEqual(['country', 'device']);
    expect(out.fields.device.values).toHaveLength(2);
  });
});
