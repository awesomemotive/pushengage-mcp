// src/analytics/schema.test.ts
import {
  GetAnalyticsSummaryInputSchema,
  GetAnalyticsTimeseriesInputSchema,
  toAnalyticsSummary,
  toAnalyticsTimeseries,
  toTimeseriesPoint,
} from './schema';

describe('GetAnalyticsSummaryInputSchema', () => {
  it('accepts empty input (uses current site)', () => {
    expect(GetAnalyticsSummaryInputSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a positive site_id override', () => {
    expect(GetAnalyticsSummaryInputSchema.safeParse({ site_id: 30292 }).success).toBe(true);
  });

  it('rejects a non-positive site_id', () => {
    expect(GetAnalyticsSummaryInputSchema.safeParse({ site_id: 0 }).success).toBe(false);
  });
});

describe('toAnalyticsSummary', () => {
  it('extracts the total_* fields from the totals payload', () => {
    const summary = toAnalyticsSummary({
      total_subscribers: 12000,
      total_notifications_sent: 340,
      total_views: 50000,
      total_clicks: 4200,
      total_goal_count: 95,
      total_goal_value: 1234.5,
      // any extra keys are ignored
      total_unsubscribed: 180,
    });
    expect(summary).toEqual({
      total_subscribers: 12000,
      total_notifications_sent: 340,
      total_views: 50000,
      total_clicks: 4200,
      total_goal_count: 95,
      total_goal_value: 1234.5,
    });
  });

  it('coerces numeric strings', () => {
    const summary = toAnalyticsSummary({
      total_subscribers: '12000',
      total_goal_value: '99.9',
    });
    expect(summary.total_subscribers).toBe(12000);
    expect(summary.total_goal_value).toBe(99.9);
  });

  it('defaults missing or non-numeric fields to 0', () => {
    const summary = toAnalyticsSummary({ total_views: 'n/a' });
    expect(summary.total_views).toBe(0);
    expect(summary.total_subscribers).toBe(0);
    expect(summary.total_goal_count).toBe(0);
  });

  it('handles null / undefined meta', () => {
    expect(toAnalyticsSummary(null).total_clicks).toBe(0);
    expect(toAnalyticsSummary(undefined).total_clicks).toBe(0);
  });
});

describe('GetAnalyticsTimeseriesInputSchema', () => {
  const base = { start_date: '2026-03-01', end_date: '2026-05-31' };

  it('accepts a valid range and defaults group_by to day', () => {
    const result = GetAnalyticsTimeseriesInputSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.group_by).toBe('day');
    }
  });

  it('accepts week and month group_by', () => {
    expect(GetAnalyticsTimeseriesInputSchema.safeParse({ ...base, group_by: 'week' }).success).toBe(
      true,
    );
    expect(
      GetAnalyticsTimeseriesInputSchema.safeParse({ ...base, group_by: 'month' }).success,
    ).toBe(true);
  });

  it('rejects an unknown group_by', () => {
    expect(GetAnalyticsTimeseriesInputSchema.safeParse({ ...base, group_by: 'year' }).success).toBe(
      false,
    );
  });

  it('rejects a malformed date', () => {
    expect(
      GetAnalyticsTimeseriesInputSchema.safeParse({
        start_date: '03-01-2026',
        end_date: '2026-05-31',
      }).success,
    ).toBe(false);
  });

  it('rejects end_date before start_date', () => {
    expect(
      GetAnalyticsTimeseriesInputSchema.safeParse({
        start_date: '2026-05-31',
        end_date: '2026-03-01',
      }).success,
    ).toBe(false);
  });
});

describe('toTimeseriesPoint / toAnalyticsTimeseries', () => {
  it('renames the terse API columns to readable keys', () => {
    const point = toTimeseriesPoint({
      date_create: '2026-03-01',
      subscribers: 120,
      notifications_sent: 4,
      views: 900,
      click: 75,
      click_rate: 8.3,
      unsubscribed: 5,
      // ignored extras
      total_notifications: 4,
      desktop_subscribers: 80,
      site_id: 35,
    });
    expect(point).toEqual({
      period: '2026-03-01',
      subscribers: 120,
      notifications_sent: 4,
      views: 900,
      clicks: 75,
      ctr: 8.3,
      unsubscribed: 5,
    });
  });

  it('keeps the week/month period label string as-is', () => {
    expect(toTimeseriesPoint({ date_create: '2026-03-01,2026-03-07' }).period).toBe(
      '2026-03-01,2026-03-07',
    );
    expect(toTimeseriesPoint({ date_create: 'March,2026' }).period).toBe('March,2026');
  });

  it('normalizes a numeric month bucket ("M,YYYY") to ISO "YYYY-MM" only when group_by is month', () => {
    expect(toTimeseriesPoint({ date_create: '6,2026' }, 'month').period).toBe('2026-06');
    expect(toTimeseriesPoint({ date_create: '12,2026' }, 'month').period).toBe('2026-12');
    // passthrough when group_by isn't month, and day buckets are untouched
    expect(toTimeseriesPoint({ date_create: '6,2026' }).period).toBe('6,2026');
    expect(toTimeseriesPoint({ date_create: '2026-06-27' }, 'day').period).toBe('2026-06-27');
    // via the array mapper
    expect(toAnalyticsTimeseries([{ date_create: '6,2026' }], 'month')[0].period).toBe('2026-06');
  });

  it('maps an array of rows and tolerates non-array input', () => {
    const series = toAnalyticsTimeseries([
      { date_create: '2026-03-01', views: 10, click: 1 },
      { date_create: '2026-03-02', views: 20, click: 3 },
    ]);
    expect(series).toHaveLength(2);
    expect(series[1]).toMatchObject({ period: '2026-03-02', views: 20, clicks: 3 });
    expect(toAnalyticsTimeseries(null)).toEqual([]);
    expect(toAnalyticsTimeseries({})).toEqual([]);
  });
});
